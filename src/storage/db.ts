// SQLite connection + schema bootstrap
// Uses bun:sqlite + drizzle-orm/bun-sqlite for Bun runtime compatibility.
// Uses CREATE TABLE IF NOT EXISTS for simplicity (no migration files needed).

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../session/session.sql"

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  title TEXT,
  directory TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  model_id TEXT,
  provider_id TEXT,
  finish TEXT CHECK(finish IN ('stop', 'tool-calls', 'length')),
  cost REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  time_created INTEGER NOT NULL,
  time_completed INTEGER
);

CREATE TABLE IF NOT EXISTS part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES message(id),
  session_id TEXT NOT NULL REFERENCES session(id),
  type TEXT NOT NULL CHECK(type IN ('text', 'tool', 'step-start', 'step-finish', 'summary')),
  data TEXT NOT NULL
);
`

export function getDB(dbPath?: string) {
  if (_db) return _db
  const sqlite = new Database(dbPath ?? "atom.db", { create: true })
  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  sqlite.run("PRAGMA foreign_keys = ON")
  sqlite.exec(CREATE_TABLES)
  _db = drizzle({ client: sqlite, schema })
  return _db
}
