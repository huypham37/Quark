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
import { error as notifyError } from "../notification/notification"

// Per-session last-known input token count — survives session switches so
// returning to a session restores the correct context-window %.
const sessionTokens = new Map<string, number>()

/**
 * Categorize a provider error into a human-readable title and message
 * for display in the notification system.
 * Returns null for abort errors (user-initiated cancellation — not an error).
 */
function categorizeError(err: unknown): { title: string; message: string } | null {
  // Abort errors are user-initiated — don't show notification
  if (err instanceof DOMException && err.name === "AbortError") return null
  if (err instanceof Error && err.name === "AbortError") return null
  
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  
  // Also catch abort-like messages
  if (lower.includes("aborted") || lower.includes("cancelled") || lower.includes("canceled")) {
    return null
  }
  
  const e = err as any
  const status: number | undefined =
    typeof e?.status === "number" ? e.status
    : typeof e?.statusCode === "number" ? e.statusCode
    : typeof e?.response?.status === "number" ? e.response.status
    : undefined

  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { title: "Rate Limited", message }
  }
  if (lower.includes("quota") || lower.includes("exceeded your") || lower.includes("billing")) {
    return { title: "Quota Exceeded", message }
  }
  if (
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("maximum context") ||
    lower.includes("too many tokens") ||
    lower.includes("reduce the length")
  ) {
    return { title: "Context Too Large", message }
  }
  if (status === 401 || lower.includes("unauthorized") || lower.includes("api key") || lower.includes("authentication")) {
    return { title: "Authentication Failed", message }
  }
  if (status === 403 || lower.includes("forbidden") || lower.includes("access denied")) {
    return { title: "Access Denied", message }
  }
  if (status === 404 || lower.includes("model not found") || lower.includes("no such model")) {
    return { title: "Model Not Found", message }
  }
  return { title: "Provider Error", message }
}

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

    unsubs.push(on("error", (data) => {
      const result = categorizeError(data.error)
      if (result) {
        notifyError(result.title, result.message, 8000) // 8s for errors, then auto-dismiss
      }
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
      if (tokens) {
        // Context window usage = inputTokens only.
        // cacheRead and cacheWrite are breakdowns *within* inputTokens, not
        // additive — summing them causes 2-3x inflation (seen as >100%).
        // outputTokens are generated tokens, not context window consumption.
        const total = tokens.input ?? 0
        if (total > 0) {
          lastInputTokens = total
          sessionTokens.set(sid, lastInputTokens)
          dispatch(state, { type: "update-status", partial: { tokensUsed: lastInputTokens } })
        }
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
