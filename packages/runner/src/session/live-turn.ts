// Cross-process single-executor reservation for a persisted session.
import { mkdirSync, readFileSync, rmSync, writeFileSync, statSync, renameSync } from "node:fs"
import { join } from "node:path"
import { getSessionDir, getSessionStorageRoot } from "../storage/session-path"
import { randomUUID } from "node:crypto"
import type { TypedBus, BusEventName } from "./events"
import { appendFileSync } from "node:fs"

const STALE_MS = 30_000
const HEARTBEAT_MS = 2_000

function lockPath(id: string, root: string): string {
  return join(getSessionDir(id, root), "active-turn")
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
      if (bus) {
        const names: BusEventName[] = ["user-message", "assistant-message-start", "text-start", "text-delta", "text-end", "tool-start", "tool-input", "tool-running", "tool-end", "assistant-message-end", "user-message-status", "loop-start", "loop-end", "error", "retry", "step-finish", "reasoning-start", "reasoning-delta", "reasoning-end", "subagent-tool-start", "subagent-tool-input", "subagent-tool-running", "subagent-tool-end", "subagent-step-finish", "subagent-text-delta", "subagent-done", "subagent-error"]
        for (const name of names) {
          const listener = (data: { sessionId: string }) => {
            if (data.sessionId !== id) return
            const payload = name === "error" || name === "retry"
              ? { ...data, error: String((data as { sessionId: string; error?: unknown }).error) }
              : data
            appendFileSync(join(getSessionDir(id, root), "live-events.jsonl"), JSON.stringify({ name, data: payload }) + "\n")
          }
          bus.on(name, listener as any)
          listeners.push(() => bus.off(name, listener as any))
        }
      }
      const timer = setInterval(() => { if (owner(path)?.token === token) write() }, HEARTBEAT_MS)
      return () => {
        clearInterval(timer)
        for (const off of listeners) off()
        if (owner(path)?.token === token) rmSync(path, { recursive: true, force: true })
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
      try { renameSync(path, stale); rmSync(stale, { recursive: true, force: true }) }
      catch { continue }
    }
  }
  return null
}
