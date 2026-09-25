import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { getSessionDir, getSessionStorageRoot } from "@quark/runner/storage/session-path"
import { isLiveTurn } from "@quark/runner/session/live-turn"
import { loadMessages } from "@quark/runner/session/message"
import type { TypedBus, BusEventName } from "@quark/runner/session/events"
import { dbToTuiMessages } from "./state"

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
      const buffer = readFileSync(log)
      const chunk = remainder + buffer.subarray(cursor).toString("utf8")
      cursor = buffer.length
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
          bus.emit(event.name, event.data as any)
        } catch { /* incomplete or corrupt event: reconcile on next snapshot */ }
      }
    }
    if (busy !== active) {
      busy = active
      onBusy(active)
      if (!active) {
        const { messages, parts } = loadMessages(id)
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
