// Session CRUD — create, get, list, touch
//
// Backed by per-session JSONL files by default.
// Each session lives in ~/.config/quark/session/<id>/
//
// Ephemeral sessions are in-memory only — never written to disk.
//
// Persistence now goes through a narrow SessionStore contract (see ./store).
// The public functions below default to the legacy JSONL store, so existing
// CLI/TUI callers are unchanged. Instance runners pass their own store (the
// portable default is an in-memory MemorySessionStore) so two runners never
// share history, even for the same session ID.

import { generateId } from "ai"
import {
  createSessionLog,
  appendEvents,
  readSessionMeta,
  scanSessionMetas,
  replaySessionFile,
  deleteSessionLog,
} from "../storage/session-jsonl"
import type { SessionLogEvent, SessionUpdateEvent } from "../storage/session-format"
import type { SessionStore } from "./store"
import { bus, type TypedBus } from "./events"

export type SessionKind = "main" | "subagent" | "ephemeral"

// ---------------------------------------------------------------------------
// In-memory store for ephemeral sessions (legacy JSONL store only)
// ---------------------------------------------------------------------------
const ephemeralStore = new Map<string, Session>()

/**
 * A persisted conversation session.
 */
export interface Session {
  /** Unique session identifier (nanoid) */
  id: string
  /** Auto-generated title (set asynchronously after the first message) */
  title: string | null
  /** Working directory when the session was created */
  directory: string | null
  /** Parent session ID — set for sub-agent sessions */
  parentSessionId: string | null
  /** Session kind: `"main"` for top-level sessions, `"subagent"` for spawned children */
  kind: SessionKind
  /** Summary of work done in this session */
  summary: string | null
  /** Frozen parent summary captured when this session branches */
  parentSummary: string | null
  /** Workspace files modified during this session */
  filesModified: string[] | null
  /** Whether the session stays above ordinary recent sessions */
  pinned: boolean
  /** Unix timestamp (ms) when the session was created */
  timeCreated: number
  /** Unix timestamp (ms) of the last activity */
  timeUpdated: number
}

export type SessionPatch = Partial<Pick<
  Session,
  "title" | "summary" | "parentSummary" | "filesModified" | "pinned" | "timeUpdated"
>>

// ---------------------------------------------------------------------------
// Legacy JSONL-backed store — the default for prompt()/CLI/TUI
// ---------------------------------------------------------------------------

/**
 * Adapts the existing JSONL + ephemeral storage to the {@link SessionStore}
 * contract. Behavior is identical to the pre-store implementation; the public
 * functions below simply delegate here.
 */
class JsonlSessionStore implements SessionStore {
  readonly createOnMissing = false

  create(session: Session): void {
    if (session.kind === "ephemeral") {
      ephemeralStore.set(session.id, session)
      return
    }
    createSessionLog(session)
  }

  get(id: string): Session | null {
    const ephemeral = ephemeralStore.get(id)
    if (ephemeral) return ephemeral
    const meta = readSessionMeta(id)
    if (meta) return meta
    const { session } = replaySessionFile(id)
    return session ?? null
  }

  update(id: string, patch: SessionPatch): void {
    const now = Date.now()
    const fullPatch: SessionPatch = { ...patch, timeUpdated: patch.timeUpdated ?? now }

    const ephemeral = ephemeralStore.get(id)
    if (ephemeral) {
      Object.assign(ephemeral, fullPatch)
      return
    }

    const event: SessionUpdateEvent = {
      v: 1,
      ts: now,
      sessionId: id,
      type: "session-update",
      patch: fullPatch,
    }
    appendEvents(id, [event], fullPatch)
  }

  append(sessionId: string, events: SessionLogEvent[], metaPatch?: Partial<Session>): void {
    appendEvents(sessionId, events, metaPatch)
  }

  replay(sessionId: string) {
    return replaySessionFile(sessionId)
  }

  list(): Session[] {
    return scanSessionMetas()
  }

  delete(id: string): void {
    ephemeralStore.delete(id)
    deleteSessionLog(id)
  }
}

/** The process-global legacy store. Public CRUD defaults to this. */
export const defaultSessionStore: SessionStore = new JsonlSessionStore()

/** Check if a session is ephemeral (in-memory only, never written to disk). */
export function isEphemeral(id: string): boolean {
  return ephemeralStore.has(id)
}

/**
 * Create a new session and persist it through `store`.
 *
 * @param opts.directory - Working directory (defaults to `process.cwd()`)
 * @param opts.id - Explicit session ID (used when resuming a portable session; defaults to a new nanoid)
 * @param opts.parentSessionId - Parent session ID for sub-agent sessions
 * @param opts.kind - Explicit session kind; inferred from `parentSessionId` if omitted
 * @param opts.ephemeral - If `true`, the session is stored in-memory only (never written to disk)
 * @param store - Persistence store (defaults to the legacy JSONL store)
 */
export function createSession(opts?: {
  directory?: string
  id?: string
  parentSessionId?: string
  kind?: SessionKind
  ephemeral?: boolean
  summary?: string | null
  parentSummary?: string | null
  filesModified?: string[] | null
}, store: SessionStore = defaultSessionStore): Session {
  const now = Date.now()
  const id = opts?.id ?? generateId()

  const kind: SessionKind = opts?.ephemeral
    ? "ephemeral"
    : (opts?.kind ?? (opts?.parentSessionId ? "subagent" as const : "main" as const))

  const session: Session = {
    id,
    title: null,
    directory: opts?.directory ?? process.cwd(),
    parentSessionId: opts?.parentSessionId ?? null,
    kind,
    summary: opts?.summary ?? null,
    parentSummary: opts?.parentSummary ?? null,
    filesModified: opts?.filesModified ?? null,
    pinned: false,
    timeCreated: now,
    timeUpdated: now,
  }

  store.create(session)
  return session
}

/**
 * Retrieve a session by ID from `store`.
 *
 * @param id - Session identifier
 * @param store - Persistence store (defaults to the legacy JSONL store)
 * @throws {Error} If no session with the given ID exists
 */
export function getSession(id: string, store: SessionStore = defaultSessionStore): Session {
  const session = store.get(id)
  if (!session) throw new Error(`Session not found: ${id}`)
  return session
}

/**
 * Update the `timeUpdated` timestamp of a session (touch).
 * Called at the start of each prompt() invocation.
 * No-op for ephemeral sessions.
 */
export function touchSession(id: string, store: SessionStore = defaultSessionStore): void {
  const session = store.get(id)
  if (!session || session.kind === "ephemeral") return
  store.update(id, { timeUpdated: Date.now() })
}

export function updateSession(
  id: string,
  patch: SessionPatch,
  store: SessionStore = defaultSessionStore,
  eventBus: TypedBus = bus,
): void {
  const now = Date.now()
  const fullPatch: SessionPatch = {
    ...patch,
    timeUpdated: patch.timeUpdated ?? now,
  }

  store.update(id, fullPatch)

  if (patch.title !== undefined) {
    eventBus.emit("session-title-changed", { sessionId: id, title: patch.title, updatedAt: fullPatch.timeUpdated })
  }
}

export function setSessionTitle(
  id: string,
  title: string,
  store: SessionStore = defaultSessionStore,
  eventBus: TypedBus = bus,
): void {
  updateSession(id, { title }, store, eventBus)
}

export function setSessionPinned(
  id: string,
  pinned: boolean,
  store: SessionStore = defaultSessionStore,
): void {
  const session = getSession(id, store)
  updateSession(id, { pinned, timeUpdated: session.timeUpdated }, store)
}

export function deleteSession(id: string, store: SessionStore = defaultSessionStore): void {
  getSession(id, store)
  store.delete(id)
}

/** List user-facing sessions only (main sessions and branches), most recently updated first */
export function listSessions(store: SessionStore = defaultSessionStore): Session[] {
  return store.list()
    .filter((s) => s.kind === "main")
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}

/** List sessions scoped to the given directory (defaults to process.cwd()), most recently updated first */
export function listProjectSessions(directory?: string, store: SessionStore = defaultSessionStore): Session[] {
  const dir = directory ?? process.cwd()
  return store.list()
    .filter((s) => s.kind === "main" && s.directory === dir)
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}

/** List all sessions including sub-agents, most recently updated first */
export function listAllSessions(store: SessionStore = defaultSessionStore): Session[] {
  return store.list()
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}

/** List child sessions of a given parent, most recently updated first */
export function listChildSessions(parentId: string, store: SessionStore = defaultSessionStore): Session[] {
  return store.list()
    .filter((s) => s.parentSessionId === parentId)
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}
