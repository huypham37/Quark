// useEventBus — subscribes to the event bus and dispatches state updates
//
// This hook bridges the backend processor events to the TUI React state.
// It subscribes on mount and unsubscribes on unmount.

import { useEffect, useRef } from "react"
import { bus, type BusEventName, type BusEvents } from "../../session/events"
import type { TuiAction } from "../state/state"

export function useEventBus(
  sessionId: string | null,
  dispatch: (action: TuiAction) => void,
) {
  // Track cumulative tokens across step-finish events
  const totalTokensRef = useRef(0)

  useEffect(() => {
    if (!sessionId) return

    // Reset token counter for new session subscriptions
    totalTokensRef.current = 0

    // Filter events by sessionId
    function on<K extends BusEventName>(event: K, handler: (data: BusEvents[K]) => void) {
      const wrapped = (data: BusEvents[K]) => {
        if ((data as any).sessionId === sessionId) {
          handler(data)
        }
      }
      bus.on(event, wrapped)
      return () => bus.off(event, wrapped)
    }

    const unsubs: (() => void)[] = []

    unsubs.push(on("assistant-message-start", (data) => {
      dispatch({ type: "add-assistant-message", id: data.messageId })
    }))

    unsubs.push(on("text-start", (data) => {
      dispatch({ type: "text-start", messageId: data.messageId })
    }))

    unsubs.push(on("text-delta", (data) => {
      dispatch({ type: "text-delta", messageId: data.messageId, delta: data.delta, text: data.text })
    }))

    unsubs.push(on("text-end", (data) => {
      dispatch({ type: "text-end", messageId: data.messageId, text: data.text })
    }))

    unsubs.push(on("tool-start", (data) => {
      dispatch({ type: "tool-start", messageId: data.messageId, tool: data.tool, callId: data.callId })
    }))

    unsubs.push(on("tool-input", (data) => {
      dispatch({ type: "tool-input", messageId: data.messageId, callId: data.callId, input: data.input })
    }))

    unsubs.push(on("tool-end", (data) => {
      dispatch({ type: "tool-end", messageId: data.messageId, callId: data.callId, status: data.status, output: data.output, error: data.error })
    }))

    unsubs.push(on("assistant-message-end", (data) => {
      dispatch({ type: "assistant-done", messageId: data.messageId })
    }))

    unsubs.push(on("loop-start", () => {
      dispatch({ type: "set-running", running: true })
    }))

    unsubs.push(on("loop-end", () => {
      dispatch({ type: "set-running", running: false })
    }))

    unsubs.push(on("error", (data) => {
      const err = data.error
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: "set-error", message })
    }))

    unsubs.push(on("permission-request", (data) => {
      dispatch({
        type: "set-permission",
        request: {
          requestId: data.requestId,
          tool: data.tool,
          input: data.input,
        },
      })
    }))

    unsubs.push(on("step-finish", (data) => {
      // Accumulate token usage across all steps
      const tokens = data.data.tokens
      if (tokens) {
        totalTokensRef.current += (tokens.input ?? 0) + (tokens.output ?? 0)
        dispatch({
          type: "update-status",
          partial: {
            tokensUsed: totalTokensRef.current,
          },
        })
      }
    }))

    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [sessionId, dispatch])
}
