import { closeSync, openSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import { getSessionDir, getSessionStorageRoot } from "@quark/runner/storage/session-path"
import { isLiveTurn } from "@quark/runner/session/live-turn"
import { loadMessages, type PartRow } from "@quark/runner/session/message"
import type { TypedBus, BusEventName } from "@quark/runner/session/events"
import { dbToTuiMessages } from "./state"

/**
 * Read exactly `count` bytes at `offset`.
 *
 * The live log can reach hundreds of MB, so advancing the cursor must not read
 * the whole file: only the unseen tail. Short reads return what was available
 * and the caller advances by that much, re-reading on the next tick.
 */
function readAt(path: string, offset: number, count: number): Buffer {
  const buffer = Buffer.allocUnsafe(count)
  const fd = openSync(path, "r")
  try {
    let read = 0
    while (read < count) {
      const n = readSync(fd, buffer, read, count - read, offset + read)
      if (n <= 0) break
      read += n
    }
    return read === count ? buffer : buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/** Follow an executor's event log, reconciling against durable history on attach/reconnect. */
export function followSession(id: string, bus: TypedBus, onBusy: (busy: boolean) => void, isLocalBusy: () => boolean = () => false): () => void {
  const dir = getSessionDir(id, getSessionStorageRoot())
  const log = join(dir, "live-events.jsonl")
  const history = join(dir, "session.jsonl")
  let cursor = 0
  let remainder = ""
  let lastHistorySize = -1
  let busy = false
  let wasLocal = false
  const seen = new Set<string>()
  const seenTools = new Set<string>()
  // Reconstruct each part's full text from delta-only log lines. `text` is a
  // SET in the TUI reducer, so a delta must be spliced onto the part's existing
  // text. Seed from persisted history: a viewer attaching mid-turn has the
  // part's prefix in session.jsonl while the deltas that produced it sit behind
  // its cursor, so without seeding the first replayed delta wipes that prefix.
  const accumulated = new Map<string, string>()
  const seeded = new Map<string, string>()
  const seedParts = (parts: PartRow[]) => {
    accumulated.clear()
    seeded.clear()
    for (const part of parts) {
      if (part.type !== "text" && part.type !== "summary" && part.type !== "reasoning") continue
      try {
        const data = JSON.parse(part.data) as { text?: string }
        if (data.text) seeded.set(part.id, data.text)
      } catch { /* corrupt part: leave it unseeded */ }
    }
  }
  const size = (path: string) => { try { return statSync(path).size } catch { return 0 } }
  const refresh = () => {
    if (isLocalBusy()) { wasLocal = true; return }
    if (wasLocal) {
      wasLocal = false
      cursor = size(log)
      lastHistorySize = -1
    }
    const active = isLiveTurn(id)
    const length = size(log)
    const historySize = size(history)
    if (length < cursor || historySize < lastHistorySize) {
      cursor = 0
      remainder = ""
      lastHistorySize = -1
    }
    // On first attach (or after a missed event), use the persisted snapshot.
    // Taking the cursor before loading ensures events emitted during replay are followed.
    if (lastHistorySize < 0) {
      cursor = length
      const { messages, parts } = loadMessages(id)
      seedParts(parts)
      seen.clear()
      seenTools.clear()
      for (const message of messages) seen.add(message.id)
      const snapshot = dbToTuiMessages(messages, parts)
      for (const message of snapshot) {
        for (const part of message.parts) if (part.type === "tool") seenTools.add(part.callId)
      }
      bus.emit("session-switch", { kind: "replace", sessionId: id, messages: snapshot as any })
      lastHistorySize = size(history)
    }
    if (length > cursor) {
      const buffer = readAt(log, cursor, length - cursor)
      const chunk = remainder + buffer.toString("utf8")
      cursor += buffer.length
      const lines = chunk.split("\n")
      remainder = lines.pop() ?? ""
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { name: BusEventName; data: { sessionId: string } }
          if (event.data.sessionId !== id) continue
          const messageId = (event.data as { messageId?: string }).messageId
          if ((event.name === "user-message" || event.name === "assistant-message-start") && messageId) {
            if (seen.has(messageId)) continue
            seen.add(messageId)
          }
          if (event.name === "tool-start") {
            const callId = (event.data as { callId?: string }).callId
            if (callId && seenTools.has(callId)) continue
            if (callId) seenTools.add(callId)
          }
          // The log stores only the new chunk for deltas; splice it onto the
          // part's prefix so the SET-style reducer receives full text again.
          const deltaData = event.data as { partId?: string; delta?: string }
          let outgoing = event.data
          if ((event.name === "text-delta" || event.name === "reasoning-delta") && deltaData.partId) {
            const base = accumulated.get(deltaData.partId) ?? seeded.get(deltaData.partId) ?? ""
            const full = base + (deltaData.delta ?? "")
            accumulated.set(deltaData.partId, full)
            outgoing = { ...event.data, text: full } as typeof event.data
          } else if ((event.name === "text-end" || event.name === "reasoning-end") && deltaData.partId) {
            // The end event carries the authoritative (trimmed) text; drop the
            // reconstruction state so a reused part id cannot leak stale text.
            accumulated.delete(deltaData.partId)
            seeded.delete(deltaData.partId)
          }
          bus.emit(event.name, outgoing as any)
        } catch { /* incomplete or corrupt event: reconcile on next snapshot */ }
      }
    }
    if (busy !== active) {
      busy = active
      onBusy(active)
      if (!active) {
        const { messages, parts } = loadMessages(id)
        seedParts(parts)
        const snapshot = dbToTuiMessages(messages, parts)
        seen.clear()
        seenTools.clear()
        for (const message of snapshot) {
          seen.add(message.id)
          for (const part of message.parts) if (part.type === "tool") seenTools.add(part.callId)
        }
        bus.emit("session-switch", { kind: "replace", sessionId: id, messages: snapshot as any })
        bus.emit("loop-end", { sessionId: id })
      } else {
        bus.emit("loop-start", { sessionId: id })
      }
    }
    lastHistorySize = historySize
  }
  refresh()
  const timer = setInterval(() => { try { refresh() } catch { /* retry after transient file write */ } }, 150)
  return () => clearInterval(timer)
}
