// Event bus — typed events emitted by the processor for real-time TUI updates
//
// Uses Node-compatible EventEmitter (works in Bun).
// The TUI subscribes to these events to render streaming content,
// tool call progress, token usage, etc.

import { EventEmitter } from "events"
import type { TextPartData, ToolPartData, StepFinishData, MessageRow } from "./message"
import type { TuiMessage } from "../tui/state"

// ---- Event types ----

export interface BusEvents {
  // A user message was saved
  "user-message": { sessionId: string; messageId: string; text: string }

  // An assistant message was created (start of response)
  "assistant-message-start": { sessionId: string; messageId: string }

  // Streaming text deltas
  "text-start": { sessionId: string; messageId: string; partId: string }
  "text-delta": { sessionId: string; messageId: string; partId: string; delta: string; text: string }
  "text-end": { sessionId: string; messageId: string; partId: string; text: string }

  // Tool lifecycle
  "tool-start": { sessionId: string; messageId: string; partId: string; tool: string; callId: string }
  "tool-input": { sessionId: string; messageId: string; partId: string; tool: string; callId: string; input: Record<string, unknown> }
  "tool-end": { sessionId: string; messageId: string; partId: string; tool: string; callId: string; status: "completed" | "error"; output?: string; error?: string; diff?: string }

  // Streaming reasoning/thinking deltas (extended thinking)
  "reasoning-start": { sessionId: string; messageId: string; partId: string }
  "reasoning-delta": { sessionId: string; messageId: string; partId: string; delta: string; text: string }
  "reasoning-end": { sessionId: string; messageId: string; partId: string }

  // Step boundaries
  "step-start": { sessionId: string; messageId: string }
  "step-finish": { sessionId: string; messageId: string; data: StepFinishData }

  // Assistant message completed
  "assistant-message-end": { sessionId: string; messageId: string; finish: "stop" | "tool-calls" | "length" }

  // Agent loop lifecycle
  "loop-start": { sessionId: string }
  "loop-end": { sessionId: string }

  // Permission request (TUI needs to prompt user)
  "permission-request": { sessionId: string; requestId: string; tool: string; input: Record<string, unknown> }

  // Compaction lifecycle
  "compaction-start": { sessionId: string }
  "compaction-end": { sessionId: string; result: import("./compact-resolver").CompactResult | null }

  // Error
  "error": { sessionId: string; error: unknown }

  // Session was lazily created (first message in a new conversation)
  "session-created": { sessionId: string }

  // Session was reset (e.g. /clear command — TUI should switch to new session)
  "session-reset": { sessionId: string | null }

  // Session was switched (e.g. /sessions <id> — TUI loads existing session)
  // estimatedTokens: if provided (e.g. post-compaction), the status bar is
  // updated immediately instead of showing 0 until the next step-finish.
  "session-switch": { sessionId: string; messages: TuiMessage[]; estimatedTokens?: number }

  // ---------------------------------------------------------------------------
  // Sub-agent observability — events forwarded from child `quark --sub-agent`
  // processes via stderr NDJSON. The parent Bash tool parses these and re-emits
  // them on the parent bus so the TUI can render nested tool activity.
  // ---------------------------------------------------------------------------

  // A tool started in the sub-agent
  "subagent-tool-start": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string; tool: string; callId: string
  }

  // Tool input resolved in the sub-agent
  "subagent-tool-input": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string; tool: string; callId: string; input: Record<string, unknown>
  }

  // Tool completed/errored in the sub-agent
  "subagent-tool-end": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string; tool: string; callId: string
    status: "completed" | "error"; error?: string
  }

  // Sub-agent step finished — carries token usage
  "subagent-step-finish": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string; tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
    tokenLimit?: number
  }

  // Streaming text from the sub-agent
  "subagent-text-delta": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string; text: string
  }

  // Sub-agent loop finished
  "subagent-done": {
    sessionId: string; messageId: string; parentCallId: string
    profile: string
  }
}

export type BusEventName = keyof BusEvents

// ---- Singleton bus ----

class TypedBus {
  private emitter = new EventEmitter()

  constructor() {
    // Allow many listeners (one per active TUI component)
    this.emitter.setMaxListeners(100)
  }

  on<K extends BusEventName>(event: K, handler: (data: BusEvents[K]) => void): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void)
  }

  off<K extends BusEventName>(event: K, handler: (data: BusEvents[K]) => void): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void)
  }

  once<K extends BusEventName>(event: K, handler: (data: BusEvents[K]) => void): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void)
  }

  emit<K extends BusEventName>(event: K, data: BusEvents[K]): void {
    this.emitter.emit(event, data)
  }

  removeAllListeners(event?: BusEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event)
    } else {
      this.emitter.removeAllListeners()
    }
  }
}

// Singleton instance
export const bus = new TypedBus()
