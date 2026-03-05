// Session CRUD — create, get, list, touch

import { eq, desc } from "drizzle-orm"
import { generateId } from "ai"
import { getDB } from "../storage/db"
import { session } from "./session.sql"

export interface Session {
  id: string
  title: string | null
  directory: string | null
  timeCreated: number
  timeUpdated: number
}

export function createSession(directory?: string): Session {
  const db = getDB()
  const now = Date.now()
  const id = generateId()

  const row = {
    id,
    title: null,
    directory: directory ?? process.cwd(),
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

/** List all sessions, most recently updated first */
export function listSessions(): Session[] {
  const db = getDB()
  return db.select().from(session).orderBy(desc(session.timeUpdated)).all()
}
