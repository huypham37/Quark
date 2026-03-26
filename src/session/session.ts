// Session CRUD — create, get, list, touch

import { eq, desc, isNull } from "drizzle-orm"
import { generateId } from "ai"
import { getDB } from "../storage/db"
import { session } from "./session.sql"

export type SessionKind = "main" | "subagent"

export interface Session {
  id: string
  title: string | null
  directory: string | null
  parentSessionId: string | null
  kind: SessionKind
  timeCreated: number
  timeUpdated: number
}

export function createSession(opts?: {
  directory?: string
  parentSessionId?: string
  kind?: SessionKind
}): Session {
  const db = getDB()
  const now = Date.now()
  const id = generateId()

  const row = {
    id,
    title: null,
    directory: opts?.directory ?? process.cwd(),
    parentSessionId: opts?.parentSessionId ?? null,
    kind: opts?.kind ?? (opts?.parentSessionId ? "subagent" as const : "main" as const),
    timeCreated: now,
    timeUpdated: now,
  }

  db.insert(session).values(row).run()
  return row
}

export function getSession(id: string): Session {
  const db = getDB()
  const row = db.select().from(session).where(eq(session.id, id)).get()
  if (!row) throw new Error(`Session not found: ${id}`)
  return row
}

export function touchSession(id: string): void {
  const db = getDB()
  db.update(session)
    .set({ timeUpdated: Date.now() })
    .where(eq(session.id, id))
    .run()
}

export function setSessionTitle(id: string, title: string): void {
  const db = getDB()
  db.update(session)
    .set({ title, timeUpdated: Date.now() })
    .where(eq(session.id, id))
    .run()
}

/** List top-level sessions only (no sub-agent children), most recently updated first */
export function listSessions(): Session[] {
  const db = getDB()
  return db.select().from(session)
    .where(isNull(session.parentSessionId))
    .orderBy(desc(session.timeUpdated))
    .all()
}

/** List all sessions including sub-agents, most recently updated first */
export function listAllSessions(): Session[] {
  const db = getDB()
  return db.select().from(session).orderBy(desc(session.timeUpdated)).all()
}

/** List child sessions of a given parent, most recently updated first */
export function listChildSessions(parentId: string): Session[] {
  const db = getDB()
  return db.select().from(session)
    .where(eq(session.parentSessionId, parentId))
    .orderBy(desc(session.timeUpdated))
    .all()
}
