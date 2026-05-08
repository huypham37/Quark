// Session CRUD — create, get, list, touch
//
// Backed by per-session JSONL files instead of SQLite.
// Each session lives in ~/.config/quark/session/<id>/
//
// Ephemeral sessions are in-memory only — never written to disk.

import { generateId } from "ai"
import {
  createSessionLog,
  appendEvents,
  readSessionMeta,
  scanSessionMetas,
  replaySessionFile,
} from "../storage/session-jsonl"
import type { SessionUpdateEvent } from "../storage/session-format"

export type SessionKind = "main" | "subagent" | "ephemeral"

// ---------------------------------------------------------------------------
// In-memory store for ephemeral sessions
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
  /** Task this session belongs to */
  taskId: string | null
  /** Summary of work done in this session */
  summary: string | null
  /** Frozen parent summary captured when this session branches */
  parentSummary: string | null
  /** Workspace files modified during this session */
  filesModified: string[] | null
  /** Unix timestamp (ms) when the session was created */
  timeCreated: number
  /** Unix timestamp (ms) of the last activity */
  timeUpdated: number
}

export type SessionPatch = Partial<Pick<
  Session,
  "title" | "taskId" | "summary" | "parentSummary" | "filesModified" | "timeUpdated"
>>

/**
 * Create a new session and persist it to JSONL storage.
 *
 * @param opts.directory - Working directory (defaults to `process.cwd()`)
 * @param opts.parentSessionId - Parent session ID for sub-agent sessions
 * @param opts.kind - Explicit session kind; inferred from `parentSessionId` if omitted
 * @param opts.ephemeral - If `true`, the session is stored in-memory only (never written to disk)
 * @returns The newly created {@link Session}
 */
export function createSession(opts?: {
  directory?: string
  parentSessionId?: string
  kind?: SessionKind
  ephemeral?: boolean
  taskId?: string | null
  summary?: string | null
  parentSummary?: string | null
  filesModified?: string[] | null
}): Session {
  const now = Date.now()
  const id = generateId()

  const kind: SessionKind = opts?.ephemeral
    ? "ephemeral"
    : (opts?.kind ?? (opts?.parentSessionId ? "subagent" as const : "main" as const))

  const session: Session = {
    id,
    title: null,
    directory: opts?.directory ?? process.cwd(),
    parentSessionId: opts?.parentSessionId ?? null,
    kind,
    taskId: opts?.taskId ?? null,
    summary: opts?.summary ?? null,
    parentSummary: opts?.parentSummary ?? null,
    filesModified: opts?.filesModified ?? null,
    timeCreated: now,
    timeUpdated: now,
  }

  if (kind === "ephemeral") {
    ephemeralStore.set(id, session)
  } else {
    createSessionLog(session)
  }

  return session
}

/**
 * Retrieve a session by ID.
 *
 * Checks ephemeral in-memory store first, then meta.json (fast path),
 * then falls back to full JSONL replay.
 *
 * @param id - Session identifier
 * @throws {Error} If no session with the given ID exists
 */
export function getSession(id: string): Session {
  // Ephemeral in-memory path
  const ephemeral = ephemeralStore.get(id)
  if (ephemeral) return ephemeral

  // Fast path: read from meta.json
  const meta = readSessionMeta(id)
  if (meta) return meta

  // Slow path: replay JSONL file
  const { session } = replaySessionFile(id)
  if (!session) throw new Error(`Session not found: ${id}`)
  return session
}

/**
 * Update the `timeUpdated` timestamp of a session (touch).
 * Called at the start of each `prompt()` invocation.
 * No-op for ephemeral sessions.
 */
/** Check if a session is ephemeral (in-memory only, never written to disk). */
export function isEphemeral(id: string): boolean {
  return ephemeralStore.has(id)
}

export function touchSession(id: string): void {
  if (ephemeralStore.has(id)) return

  const now = Date.now()
  const event: SessionUpdateEvent = {
    v: 1,
    ts: now,
    sessionId: id,
    type: "session-update",
    patch: { timeUpdated: now },
  }
  appendEvents(id, [event], { timeUpdated: now })
}

export function updateSession(id: string, patch: SessionPatch): void {
  const now = Date.now()
  const fullPatch: SessionPatch = {
    ...patch,
    timeUpdated: patch.timeUpdated ?? now,
  }

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

export function setSessionTitle(id: string, title: string): void {
  updateSession(id, { title })
}

/** List user-facing sessions only (main sessions and branches), most recently updated first */
export function listSessions(): Session[] {
  return scanSessionMetas()
    .filter((s) => s.kind === "main")
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}

/** List all sessions including sub-agents, most recently updated first */
export function listAllSessions(): Session[] {
  return scanSessionMetas()
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}

/** List child sessions of a given parent, most recently updated first */
export function listChildSessions(parentId: string): Session[] {
  return scanSessionMetas()
    .filter((s) => s.parentSessionId === parentId)
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
}
