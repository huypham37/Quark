// Low-level JSONL filesystem operations for session storage
//
// All functions are synchronous (Bun fs is sync-friendly) except where noted.
// Each session is stored in its own directory:
//   ~/.config/quark/session/<id>/session.jsonl   — append-only event log
//   ~/.config/quark/session/<id>/meta.json       — derived cache
//
// Write strategy:
//   - JSONL: open(O_APPEND | O_WRONLY), write, close — no locking needed
//   - meta.json: write to .tmp, rename (atomic on POSIX)

import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs"
import { join } from "node:path"
import {
  getSessionDir,
  getSessionLogPath,
  getSessionMetaPath,
  getSessionStorageRoot,
} from "./session-path"
import type {
  SessionLogEvent,
  SessionEvent,
  SessionMetaFile,
} from "./session-format"
import type { Session } from "../session/session"
import type { MessageRow, PartRow } from "../session/message"

// ---------------------------------------------------------------------------
// ensureStorageRoot — create the top-level session directory
// ---------------------------------------------------------------------------

export function ensureStorageRoot(): void {
  mkdirSync(getSessionStorageRoot(), { recursive: true })
}

// ---------------------------------------------------------------------------
// createSessionLog — create dir + write first event + meta.json
// ---------------------------------------------------------------------------

export function createSessionLog(session: Session): void {
  const dir = getSessionDir(session.id)
  mkdirSync(dir, { recursive: true })

  const event: SessionEvent = {
    v: 1,
    ts: Date.now(),
    sessionId: session.id,
    type: "session",
    session,
  }

  writeFileSync(getSessionLogPath(session.id), JSON.stringify(event) + "\n")
  writeMetaAtomic(session.id, session)
}

// ---------------------------------------------------------------------------
// appendEvents — append one or more events to the JSONL file
//
// If metaPatch is provided, atomically rewrite meta.json with the patch
// applied to the current session object.
// ---------------------------------------------------------------------------

export function appendEvents(
  sessionId: string,
  events: SessionLogEvent[],
  metaPatch?: Partial<Session>,
): void {
  if (events.length === 0) return

  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
  appendFileSync(getSessionLogPath(sessionId), lines)

  if (metaPatch) {
    // Read current meta, apply patch, rewrite
    const current = readSessionMeta(sessionId)
    if (current) {
      const updated = { ...current, ...metaPatch }
      writeMetaAtomic(sessionId, updated)
    }
  }
}

// ---------------------------------------------------------------------------
// readSessionMeta — read meta.json for a session
// ---------------------------------------------------------------------------

export function readSessionMeta(sessionId: string): Session | null {
  const path = getSessionMetaPath(sessionId)
  try {
    const raw = readFileSync(path, "utf-8")
    const parsed = JSON.parse(raw) as SessionMetaFile
    if (parsed.v === 1 && parsed.session) return parsed.session
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// scanSessionMetas — scan all meta.json files for session listing
// ---------------------------------------------------------------------------

export function scanSessionMetas(): Session[] {
  const root = getSessionStorageRoot()
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }

  const sessions: Session[] = []
  for (const entry of entries) {
    const metaPath = join(root, entry, "meta.json")
    try {
      const raw = readFileSync(metaPath, "utf-8")
      const parsed = JSON.parse(raw) as SessionMetaFile
      if (parsed.v === 1 && parsed.session) {
        sessions.push(parsed.session)
      }
    } catch {
      // Skip corrupt or missing meta.json — can be rebuilt from JSONL
      continue
    }
  }

  return sessions
}

// ---------------------------------------------------------------------------
// replaySessionFile — full replay of session.jsonl → { session, messages, parts }
//
// Reads the entire file and materializes the final state.
// ---------------------------------------------------------------------------

export function replaySessionFile(sessionId: string): {
  session: Session | null
  messages: MessageRow[]
  parts: PartRow[]
} {
  const logPath = getSessionLogPath(sessionId)
  let raw: string
  try {
    raw = readFileSync(logPath, "utf-8")
  } catch {
    return { session: null, messages: [], parts: [] }
  }

  let session: Session | null = null
  const messagesMap = new Map<string, MessageRow>()
  const partsMap = new Map<string, PartRow>()

  const lines = raw.split("\n")
  for (const line of lines) {
    if (!line.trim()) continue

    let event: SessionLogEvent
    try {
      event = JSON.parse(line) as SessionLogEvent
    } catch {
      // Skip malformed lines
      continue
    }

    switch (event.type) {
      case "session": {
        session = event.session
        break
      }

      case "session-update": {
        if (session) {
          if (event.patch.title !== undefined) session.title = event.patch.title
          if (event.patch.timeUpdated !== undefined) session.timeUpdated = event.patch.timeUpdated
        }
        break
      }

      case "message": {
        const row: MessageRow = {
          id: event.messageId,
          sessionId: event.sessionId,
          role: event.role,
          modelId: event.modelId,
          providerId: event.providerId,
          finish: null,
          cost: null,
          tokensIn: null,
          tokensOut: null,
          timeCreated: event.timeCreated,
          timeCompleted: null,
        }
        messagesMap.set(event.messageId, row)
        break
      }

      case "part": {
        // For the same partId, later events overwrite earlier ones
        // (this is how appendPartSnapshot replaces updatePart)
        const row: PartRow = {
          id: event.partId,
          messageId: event.messageId,
          sessionId: event.sessionId,
          type: event.partType,
          data: typeof event.data === "string" ? event.data : JSON.stringify(event.data),
        }
        partsMap.set(event.partId, row)
        break
      }

      case "message-end": {
        const msg = messagesMap.get(event.messageId)
        if (msg) {
          msg.finish = event.finish
          msg.cost = event.cost
          msg.tokensIn = event.tokensIn
          msg.tokensOut = event.tokensOut
          msg.timeCompleted = event.timeCompleted
        }
        break
      }
    }
  }

  // Convert maps to arrays, preserving insertion order (which is chronological)
  const messages = Array.from(messagesMap.values())
  const parts = Array.from(partsMap.values())

  return { session, messages, parts }
}

// ---------------------------------------------------------------------------
// rebuildSessionMeta — replay JSONL + rewrite meta.json
// ---------------------------------------------------------------------------

export function rebuildSessionMeta(sessionId: string): Session | null {
  const { session } = replaySessionFile(sessionId)
  if (session) {
    writeMetaAtomic(sessionId, session)
  }
  return session
}

// ---------------------------------------------------------------------------
// Internal: atomic meta.json write (write .tmp + rename)
// ---------------------------------------------------------------------------

function writeMetaAtomic(sessionId: string, session: Session): void {
  const metaPath = getSessionMetaPath(sessionId)
  const tmpPath = metaPath + ".tmp"
  const meta: SessionMetaFile = { v: 1, session }
  writeFileSync(tmpPath, JSON.stringify(meta, null, 2))
  renameSync(tmpPath, metaPath)
}
