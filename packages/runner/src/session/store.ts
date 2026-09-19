// SessionStore — instance-scoped session/history persistence contract.
//
// Historically every session went through the module-global JSONL store
// (`~/.config/quark/session/<id>/`). That makes two createRunner() instances
// share history whenever they reuse a session ID. This contract splits
// persistence behind a narrow interface so an instance runner can own its
// store:
//
//   - JsonlSessionStore (in session.ts) is the legacy default — files under
//     ~/.config/quark/session, unchanged CLI/TUI behavior.
//   - MemorySessionStore is the portable default for createRunner() +
//     AgentDefinition. Nothing touches disk; two runners never share a session
//     even for the same ID.
//
// The contract deliberately exposes no filesystem paths.

import type { Session, SessionPatch } from "./session"
import type { MessageRow, PartRow } from "./message"
import type { SessionLogEvent } from "../storage/session-format"
import { replayEvents } from "../storage/session-jsonl"

export interface SessionStore {
  /**
   * Whether a miss in `get()` may be implicitly created.
   *
   * `false` for the legacy JSONL store: resuming an unknown ID must throw, as
   * it always has. `true` for the memory store, where a session ID is just a
   * namespace and an unknown one starts empty.
   */
  readonly createOnMissing: boolean
  create(session: Session): void
  get(id: string): Session | null
  update(id: string, patch: SessionPatch): void
  /** Append session events; an optional metaPatch updates the cached envelope. */
  append(sessionId: string, events: SessionLogEvent[], metaPatch?: Partial<Session>): void
  replay(sessionId: string): { session: Session | null; messages: MessageRow[]; parts: PartRow[] }
  list(): Session[]
  delete(id: string): void
}

/**
 * In-memory session store — the portable default.
 *
 * Events are folded with the same replay logic as the JSONL store, so message
 * history round-trips identically. Never touches the filesystem.
 */
/** Detached copy of an envelope; callers must never observe internal state. */
function cloneSession(session: Session): Session {
  return {
    ...session,
    filesModified: session.filesModified ? [...session.filesModified] : session.filesModified,
  }
}

export class MemorySessionStore implements SessionStore {
  readonly createOnMissing = true
  private envelopes = new Map<string, Session>()
  private events = new Map<string, SessionLogEvent[]>()

  create(session: Session): void {
    this.envelopes.set(session.id, { ...session })
    this.events.set(session.id, [
      { v: 1, ts: session.timeCreated, sessionId: session.id, type: "session", session },
    ])
  }

  get(id: string): Session | null {
    const session = this.envelopes.get(id)
    return session ? cloneSession(session) : null
  }

  update(id: string, patch: SessionPatch): void {
    const current = this.envelopes.get(id)
    if (current) Object.assign(current, patch)
  }

  append(sessionId: string, events: SessionLogEvent[], metaPatch?: Partial<Session>): void {
    if (events.length === 0) return
    const existing = this.events.get(sessionId) ?? []
    existing.push(...events)
    this.events.set(sessionId, existing)
    if (metaPatch) {
      const current = this.envelopes.get(sessionId)
      if (current) Object.assign(current, metaPatch)
    }
  }

  replay(sessionId: string): { session: Session | null; messages: MessageRow[]; parts: PartRow[] } {
    const { messages, parts } = replayEvents(this.events.get(sessionId) ?? [])
    const session = this.envelopes.get(sessionId)
    return { session: session ? cloneSession(session) : null, messages, parts }
  }

  list(): Session[] {
    return Array.from(this.envelopes.values(), cloneSession)
  }

  delete(id: string): void {
    this.envelopes.delete(id)
    this.events.delete(id)
  }
}
