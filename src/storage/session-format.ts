// JSONL event types for session storage
//
// Every line in a session.jsonl file is one of these events.
// The file is append-only — no line is ever modified or deleted.
//
// Event ordering:
//   1. SessionEvent        — first line, created on session init
//   2. SessionUpdateEvent  — title change, touch
//   3. MessageEvent        — message start (user or assistant)
//   4. PartEvent           — part snapshot (text, tool, reasoning, etc.)
//   5. MessageEndEvent     — message completion with usage stats

import type { Session } from "../session/session"
import type { UsageAggregate } from "../session/accounting"

// ---------------------------------------------------------------------------
// Part types — same as the existing DB schema enum
// ---------------------------------------------------------------------------

export type PartType =
  | "text"
  | "tool"
  | "step-start"
  | "step-finish"
  | "summary"
  | "image"
  | "reasoning"

// ---------------------------------------------------------------------------
// Event base — every JSONL line has these fields
// ---------------------------------------------------------------------------

export interface EventBase {
  /** Schema version — always 1 for now */
  v: 1
  /** Unix timestamp (ms) when the event was created */
  ts: number
  /** Session this event belongs to */
  sessionId: string
}

// ---------------------------------------------------------------------------
// Session lifecycle events
// ---------------------------------------------------------------------------

export interface SessionEvent extends EventBase {
  type: "session"
  session: Session
}

export interface SessionUpdateEvent extends EventBase {
  type: "session-update"
  patch: {
    title?: string | null
    taskId?: string | null
    summary?: string | null
    parentSummary?: string | null
    filesModified?: string[] | null
    timeUpdated?: number
  }
}

// ---------------------------------------------------------------------------
// Message events
// ---------------------------------------------------------------------------

export interface MessageEvent extends EventBase {
  type: "message"
  messageId: string
  role: "user" | "assistant"
  modelId: string | null
  providerId: string | null
  timeCreated: number
}

export interface PartEvent extends EventBase {
  type: "part"
  messageId: string
  partId: string
  partType: PartType
  data: unknown // JSON-serializable part data (TextPartData, ToolPartData, etc.)
}

export interface MessageEndEvent extends EventBase {
  type: "message-end"
  messageId: string
  finish: "stop" | "tool-calls" | "length" | "aborted"
  cost: number | null
  tokensIn: number | null
  tokensOut: number | null
  timeCompleted: number
  usage?: UsageAggregate
}

// ---------------------------------------------------------------------------
// Union of all event types
// ---------------------------------------------------------------------------

export type SessionLogEvent =
  | SessionEvent
  | SessionUpdateEvent
  | MessageEvent
  | PartEvent
  | MessageEndEvent

// ---------------------------------------------------------------------------
// meta.json — derived cache for fast session listing
// ---------------------------------------------------------------------------

export interface SessionMetaFile {
  v: 1
  session: Session
}
