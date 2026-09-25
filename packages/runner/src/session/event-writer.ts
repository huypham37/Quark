// Event writer — streams structured events to stderr for parent process consumption
//
// When a sub-agent runs, the parent has no visibility into its internal tool
// execution. This module subscribes to the in-process event bus and writes
// NDJSON lines to stderr with a `QUARK_EVENT:` prefix so the parent's Bash
// tool can parse them out and render sub-agent activity in the TUI.
//
// Activated by the internal subagent supervisor via QUARK_EMIT_EVENTS=1.

import { bus } from "./events"
import type { SubagentErrorKind } from "../subagent/protocol"

// Compact event shapes — keep wire size small
export type SubAgentEvent =
  | { e: "ready"; sessionId: string; profile: string; model?: string; tokenLimit?: number }
  | { e: "tool-start"; t: string; id: string }
  | { e: "tool-input"; t: string; id: string; in: Record<string, unknown> }
  | { e: "tool-running"; id: string }
  | { e: "tool-end"; t: string; id: string; s: "completed" | "error"; err?: string }
  | { e: "step-finish"; tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }; tokenLimit?: number; model?: string }
  | { e: "text-delta"; d: string }
  | { e: "error"; kind: SubagentErrorKind; message: string }
  | { e: "loop-end" }

const PREFIX = "QUARK_EVENT:"

function emit(event: SubAgentEvent): void {
  try {
    process.stderr.write(`${PREFIX}${JSON.stringify(event)}\n`)
  } catch {
    // stderr closed — parent may have exited; silently ignore
  }
}

export function emitSubagentError(kind: SubagentErrorKind, message: string): void {
  emit({ e: "error", kind, message })
}

/**
 * Start writing events to stderr.
 * Call once at startup when running as a sub-agent.
 * @param resolvedModel - The actual model string being used (resolved from CLI flag > profile > config), used for display in the parent TUI.
 * Returns a cleanup function to unsubscribe.
 */
export function startEventWriter(options?: { resolvedModel?: string; tokenLimit?: number; profile?: string }): () => void {
  const unsubs: (() => void)[] = []

  // Resolve the model once at startup — use the passed model if provided
  const displayModel = options?.resolvedModel
  const profile = options?.profile ?? "sub-agent"

  // Emit metadata immediately so the parent TUI can show model + context limit
  // right away, instead of waiting for the first step-finish.
  const tokenLimit = options?.tokenLimit ?? 0
  emit({ e: "step-finish", tokens: { input: 0, output: 0 }, tokenLimit, model: displayModel })

  function on<K extends keyof import("./events").BusEvents>(
    event: K,
    handler: (data: import("./events").BusEvents[K]) => void,
  ) {
    bus.on(event, handler)
    unsubs.push(() => bus.off(event, handler))
  }

  on("tool-start", (data) => {
    emit({ e: "tool-start", t: data.tool, id: data.callId })
  })

  on("tool-input", (data) => {
    emit({ e: "tool-input", t: data.tool, id: data.callId, in: data.input })
  })

  on("tool-running", (data) => {
    emit({ e: "tool-running", id: data.callId })
  })

  on("tool-end", (data) => {
    emit({
      e: "tool-end",
      t: data.tool,
      id: data.callId,
      s: data.status,
      ...(data.error ? { err: data.error } : {}),
    })
  })

  on("step-finish", (data) => {
    emit({ e: "step-finish", tokens: data.data.tokens, tokenLimit, model: displayModel })
  })

  on("session-created", (data) => {
    emit({ e: "ready", sessionId: data.sessionId, profile, model: displayModel, tokenLimit })
  })

  on("error", (data) => {
    const message = data.error instanceof Error ? data.error.message : String(data.error)
    emitSubagentError("provider", message)
  })

  // Batch text deltas — emit at most every 200ms to avoid flooding
  let pendingText = ""
  let textTimer: ReturnType<typeof setTimeout> | null = null

  function flushText() {
    if (pendingText) {
      emit({ e: "text-delta", d: pendingText })
      pendingText = ""
    }
    textTimer = null
  }

  on("text-delta", (data) => {
    pendingText = data.text // send full accumulated text, not just delta
    if (!textTimer) {
      textTimer = setTimeout(flushText, 200)
    }
  })

  on("text-end", () => {
    // Flush any pending text immediately on end
    if (textTimer) {
      clearTimeout(textTimer)
      textTimer = null
    }
    flushText()
  })

  on("loop-end", () => {
    // Final flush
    flushText()
    emit({ e: "loop-end" })
  })

  return () => {
    if (textTimer) {
      clearTimeout(textTimer)
      textTimer = null
    }
    flushText()
    for (const unsub of unsubs) unsub()
  }
}
