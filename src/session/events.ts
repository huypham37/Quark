// Event bus — typed events emitted by the processor for real-time TUI updates
//
// Uses Node-compatible EventEmitter (works in Bun).
// The TUI subscribes to these events to render streaming content,
// tool call progress, token usage, etc.

import { EventEmitter } from "events"
import type { TextPartData, ToolPartData, StepFinishData, MessageRow } from "./message"
import type { TuiMessage } from "../tui/state/state"

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
  "tool-end": { sessionId: string; messageId: string; partId: string; tool: string; callId: string; status: "completed" | "error"; output?: string; error?: string }

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

  // Error
  "error": { sessionId: string; error: unknown }

  // Session was reset (e.g. /clear command — TUI should switch to new session)
  "session-reset": { sessionId: string }

  // Session was switched (e.g. /sessions <id> — TUI loads existing session)
  "session-switch": { sessionId: string; messages: TuiMessage[] }
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
