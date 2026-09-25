// Cross-process single-executor reservation for a persisted session.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from "node:fs"
import { join } from "node:path"
import { getSessionDir, getSessionStorageRoot } from "../storage/session-path"
import { randomUUID } from "node:crypto"
import type { TypedBus, BusEventName } from "./events"

const STALE_MS = 30_000
const HEARTBEAT_MS = 2_000
// Delta writes are coalesced; 200ms matches the stderr batching in event-writer.ts.
const LIVE_FLUSH_MS = 200
const LIVE_LOG = "live-events.jsonl"

function lockPath(id: string, root: string): string {
  return join(getSessionDir(id, root), "active-turn")
}

function liveLogPath(id: string, root: string): string {
  return join(getSessionDir(id, root), LIVE_LOG)
}

interface Owner { pid: number; token: string; time: number }

function owner(path: string): Owner | null {
  try {
    const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Owner
    return Number.isInteger(value.pid) && typeof value.token === "string" && Number.isFinite(value.time) ? value : null
  } catch { return null }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" }
}

/** True only while the owner is alive and refreshing its lease. */
export function isLiveTurn(id: string, root = getSessionStorageRoot()): boolean {
  const path = lockPath(id, root)
  const value = owner(path)
  return !!value && Date.now() - value.time < STALE_MS && alive(value.pid)
}

/**
 * Reclaim disk from turns that will never be read again.
 *
 * `live-events.jsonl` is a catch-up cache for an in-flight turn; the durable
 * transcript is `session.jsonl`. Once a turn is not live a viewer can only
 * reconcile it from history, so the cached log has no further use. This drops
 * the cache and any abandoned `active-turn/` lock, never `session.jsonl` or
 * `meta.json`. Guarded by {@link isLiveTurn}, so a turn another process is
 * running is never touched; a lock directory with no owner is skipped until it
 * is older than the heartbeat lease (it may still be mid-write).
 *
 * Intended to run at most once per process, at startup.
 */
export function reapStaleTurns(root = getSessionStorageRoot()): number {
  let entries: Dirent[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return 0 }
  let reaped = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    if (isLiveTurn(id, root)) continue
    const lock = lockPath(id, root)
    let hasLock = true
    try { statSync(lock) } catch { hasLock = false }
    if (hasLock && !owner(lock)) {
      try { if (Date.now() - statSync(lock).mtimeMs < STALE_MS) continue } catch { continue }
    }
    try {
      rmSync(lock, { recursive: true, force: true })
      rmSync(liveLogPath(id, root), { force: true })
      reaped++
    } catch { /* best effort: a concurrent reap is harmless */ }
  }
  return reaped
}

/** Atomic directory reservation; null means another process owns the turn. */
export function reserveLiveTurn(id: string, root = getSessionStorageRoot(), bus?: TypedBus): (() => void) | null {
  const path = lockPath(id, root)
  const token = randomUUID()
  mkdirSync(getSessionDir(id, root), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(path)
      const write = () => {
        const temp = join(path, `owner-${token}.tmp`)
        writeFileSync(temp, JSON.stringify({ pid: process.pid, token, time: Date.now() }))
        renameSync(temp, join(path, "owner.json"))
      }
      write()
      const listeners: Array<() => void> = []
      let flush: () => void = () => {}
      if (bus) {
        const log = liveLogPath(id, root)

        const append = (name: BusEventName, payload: unknown) => {
          appendFileSync(log, JSON.stringify({ name, data: payload }) + "\n")
        }

        // `text-delta`/`reasoning-delta` carry the new chunk in `delta` but the
        // whole accumulated message in `text`. The TUI applies `text` as a SET
        // (packages/quark/src/tui/state.ts), so writing every chunk re-serialises
        // the entire message each time — quadratic log growth. Keep only the
        // latest full text per part and flush on a timer. `delta` is accumulated
        // as well so an append-only consumer still reconstructs the same string.
        const pending = new Map<string, { name: BusEventName; data: Record<string, unknown>; delta: string }>()
        let flushTimer: ReturnType<typeof setTimeout> | null = null

        flush = () => {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          if (pending.size === 0) return
          for (const entry of pending.values()) {
            append(entry.name, { ...entry.data, delta: entry.delta, text: entry.data.text })
          }
          pending.clear()
        }

        const names: BusEventName[] = ["user-message", "assistant-message-start", "text-start", "text-delta", "text-end", "tool-start", "tool-input", "tool-running", "tool-end", "assistant-message-end", "user-message-status", "loop-start", "loop-end", "error", "retry", "step-finish", "reasoning-start", "reasoning-delta", "reasoning-end", "subagent-tool-start", "subagent-tool-input", "subagent-tool-running", "subagent-tool-end", "subagent-step-finish", "subagent-text-delta", "subagent-done", "subagent-error"]
        for (const name of names) {
          const listener = (data: { sessionId: string; partId?: string; delta?: string; error?: unknown }) => {
            if (data.sessionId !== id) return
            if (name === "text-delta" || name === "reasoning-delta") {
              const partId = data.partId ?? ""
              const prior = pending.get(partId)
              pending.set(partId, {
                name,
                data: data as Record<string, unknown>,
                delta: (prior?.delta ?? "") + (data.delta ?? ""),
              })
              if (!flushTimer) flushTimer = setTimeout(flush, LIVE_FLUSH_MS)
              return
            }
            // `text-end` carries the trimmed final text and must be the last
            // event for its part, so publish any buffered delta before it.
            if (name === "text-end" || name === "reasoning-end" || name === "loop-end") flush()
            const payload = name === "error" || name === "retry"
              ? { ...data, error: String(data.error) }
              : data
            append(name, payload)
          }
          bus.on(name, listener as any)
          listeners.push(() => bus.off(name, listener as any))
        }
      }
      const timer = setInterval(() => { if (owner(path)?.token === token) write() }, HEARTBEAT_MS)
      return () => {
        clearInterval(timer)
        for (const off of listeners) off()
        if (owner(path)?.token === token) {
          rmSync(path, { recursive: true, force: true })
          // Turn over: the live log is a catch-up cache, not history. The
          // durable transcript is session.jsonl and the viewer reconciles from
          // it, so the per-turn events can be dropped rather than left to grow.
          writeFileSync(liveLogPath(id, root), "")
        } else {
          // Lease lost to another process; never touch the next owner's log.
          flush()
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (isLiveTurn(id, root)) return null
      // Avoid stealing a directory whose owner is still being written.
      const value = owner(path)
      if (!value) {
        try { if (Date.now() - statSync(path).mtimeMs < STALE_MS) return null } catch { continue }
      }
      // Rename before removal: a competing contender must not observe an
      // empty unlocked path while we are deleting the stale directory.
      const stale = `${path}.stale-${token}`
      try {
        renameSync(path, stale)
        rmSync(stale, { recursive: true, force: true })
        // The previous owner is gone; its cached events are unreachable.
        rmSync(liveLogPath(id, root), { force: true })
      }
      catch { continue }
    }
  }
  return null
}
