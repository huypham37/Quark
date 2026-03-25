// wireEvents — subscribes to the event bus and mutates the SolidJS store
//
// Replaces useEventBus (React hook) with a plain function that uses
// createComputed + onCleanup for lifecycle management.
//
// We use createComputed (not createEffect or createRenderEffect) because it
// re-runs synchronously inline when its dependency (sessionId) changes.
// This ensures new bus subscriptions are active immediately after a
// session-reset or session-switch, before any subsequent events fire.

import { createComputed, onCleanup } from "solid-js"
import { bus, type BusEventName, type BusEvents } from "../session/events"
import { dispatch, type AppState } from "./state"

// Per-session last-known input token count — survives session switches so
// returning to a session restores the correct context-window %.
const sessionTokens = new Map<string, number>()

export function wireEvents(state: AppState) {
  // Last input tokens for the current session — this is the real context
  // window usage reported by the API, NOT a cumulative sum.
  let lastInputTokens = 0

  createComputed(() => {
    const sid = state.store.sessionId
    if (!sid) return

    // Restore from the per-session cache, or start at 0
    lastInputTokens = sessionTokens.get(sid) ?? 0

    function on<K extends BusEventName>(event: K, handler: (data: BusEvents[K]) => void) {
      const wrapped = (data: BusEvents[K]) => {
        if ((data as any).sessionId === sid) handler(data)
      }
      bus.on(event, wrapped)
      return () => bus.off(event, wrapped)
    }

    const unsubs: (() => void)[] = []

    unsubs.push(on("user-message", (data) => {
      dispatch(state, { type: "add-user-message", id: data.messageId, text: data.text })
    }))

    unsubs.push(on("assistant-message-start", (data) => {
      dispatch(state, { type: "add-assistant-message", id: data.messageId })
    }))

    unsubs.push(on("text-start", (data) => {
      dispatch(state, { type: "text-start", messageId: data.messageId })
    }))

    unsubs.push(on("text-delta", (data) => {
      dispatch(state, { type: "text-delta", messageId: data.messageId, delta: data.delta, text: data.text })
    }))

    unsubs.push(on("text-end", (data) => {
      dispatch(state, { type: "text-end", messageId: data.messageId, text: data.text })
    }))

    unsubs.push(on("tool-start", (data) => {
      dispatch(state, { type: "tool-start", messageId: data.messageId, tool: data.tool, callId: data.callId })
    }))

    unsubs.push(on("tool-input", (data) => {
      dispatch(state, { type: "tool-input", messageId: data.messageId, callId: data.callId, input: data.input })
    }))

    unsubs.push(on("tool-end", (data) => {
      dispatch(state, { type: "tool-end", messageId: data.messageId, callId: data.callId, status: data.status, output: data.output, error: data.error })
    }))

    unsubs.push(on("assistant-message-end", (data) => {
      dispatch(state, { type: "assistant-done", messageId: data.messageId })
      // Unlock input as soon as the final message ends (don't wait for loop-end
      // which may be delayed by compaction / DB writes)
      if (data.finish === "stop" || data.finish === "length") {
        dispatch(state, { type: "set-running", running: false })
      }
    }))

    unsubs.push(on("loop-start", () => {
      dispatch(state, { type: "set-running", running: true })
    }))

    unsubs.push(on("loop-end", () => {
      dispatch(state, { type: "set-running", running: false })
    }))

    let errorTimer: ReturnType<typeof setTimeout> | undefined
    unsubs.push(on("error", (data) => {
      const err = data.error
      const message = err instanceof Error ? err.message : String(err)
      dispatch(state, { type: "set-error", message })
      if (errorTimer) clearTimeout(errorTimer)
      errorTimer = setTimeout(() => dispatch(state, { type: "clear-error" }), 5_000)
    }))

    unsubs.push(on("permission-request", (data) => {
      dispatch(state, {
        type: "set-permission",
        request: { requestId: data.requestId, tool: data.tool, input: data.input },
      })
    }))

    unsubs.push(on("compaction-start", () => {
      dispatch(state, { type: "set-compacting", compacting: true })
    }))

    unsubs.push(on("compaction-end", () => {
      dispatch(state, { type: "set-compacting", compacting: false })
    }))

    unsubs.push(on("step-finish", (data) => {
      const tokens = data.data.tokens
      if (tokens && tokens.input !== undefined) {
        // Use the last input token count — this IS the current context window
        // usage, not a cumulative total. Each API call reports how many input
        // tokens the full prompt consumed.
        lastInputTokens = tokens.input
        sessionTokens.set(sid, lastInputTokens)
        dispatch(state, { type: "update-status", partial: { tokensUsed: lastInputTokens } })
      }
    }))

    // session-reset: unfiltered (carries NEW sessionId)
    const handleReset = (data: BusEvents["session-reset"]) => {
      // Save current session's tokens before switching away
      if (sid && lastInputTokens > 0) {
        sessionTokens.set(sid, lastInputTokens)
      }
      lastInputTokens = 0
      dispatch(state, { type: "reset-session", sessionId: data.sessionId })
    }
    bus.on("session-reset", handleReset)
    unsubs.push(() => bus.off("session-reset", handleReset))

    // session-switch: unfiltered (carries NEW sessionId + messages)
    const handleSwitch = (data: BusEvents["session-switch"]) => {
      // Save current session's tokens before switching away
      if (sid && lastInputTokens > 0) {
        sessionTokens.set(sid, lastInputTokens)
      }
      // Resolve the incoming token count from cache or estimatedTokens
      const restored = sessionTokens.get(data.sessionId)
      const incoming = restored ?? data.estimatedTokens ?? 0
      // CRITICAL: seed the map BEFORE dispatching load-session.
      // load-session mutates sessionId, which causes createComputed to re-run
      // synchronously and reset lastInputTokens from sessionTokens.
      // Seeding first ensures createComputed picks up the correct value.
      if (incoming > 0) {
        sessionTokens.set(data.sessionId, incoming)
      }
      dispatch(state, { type: "load-session", sessionId: data.sessionId, messages: data.messages })
      // After createComputed re-ran, lastInputTokens is now correctly seeded
      dispatch(state, { type: "update-status", partial: { tokensUsed: lastInputTokens } })
    }
    bus.on("session-switch", handleSwitch)
    unsubs.push(() => bus.off("session-switch", handleSwitch))

    onCleanup(() => {
      for (const unsub of unsubs) unsub()
    })
  })
}
