// Ephemeral (anonymous) session tests
//
// Verifies:
// - createSession({ ephemeral: true }) creates a session with kind=ephemeral
// - Ephemeral sessions do NOT write to disk (no session.jsonl, no meta.json)
// - listSessions() excludes ephemeral sessions (in-memory only)
// - listAllSessions() excludes ephemeral sessions (in-memory only)
// - getSession(id) returns ephemeral sessions (in-memory lookup)
// - prompt({ ephemeral: true }) creates an ephemeral session that does not persist
// - After process restart, ephemeral sessions are gone (not persisted)
//
// Ephemeral sessions are stored in-memory only, never written to disk.

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { prompt } from "../../src/session/prompt"
import {
  createSession,
  getSession,
  listSessions,
  listAllSessions,
} from "../../src/session/session"
import { bus } from "../../src/session/events"
import { bootstrap, resetBootstrap } from "../../src/bootstrap"
import { getSessionDir } from "../../src/storage/session-path"

let tmpDir: string

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-ephemeral-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
  resetBootstrap()
  await bootstrap()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  bus.removeAllListeners()
})

describe("ephemeral session: schema", () => {
  test("createSession() defaults to kind=main with no ephemeral flag", () => {
    const sess = createSession()
    expect(sess.kind).toBe("main")
  })

  test("createSession({ ephemeral: true }) sets kind=ephemeral", () => {
    const sess = createSession({ ephemeral: true })
    expect(sess.kind).toBe("ephemeral")
    expect(sess.id).toBeTruthy()
    expect(sess.timeCreated).toBeGreaterThan(0)
    expect(sess.timeUpdated).toBeGreaterThan(0)
  })

  test("getSession() returns ephemeral session from in-memory store", () => {
    const sess = createSession({ ephemeral: true })
    const fetched = getSession(sess.id)
    expect(fetched).not.toBeNull()
    expect(fetched.id).toBe(sess.id)
    expect(fetched.kind).toBe("ephemeral")
  })
})

describe("ephemeral session: persistence", () => {
  test("createSession({ ephemeral: true }) does NOT create files on disk", () => {
    const sess = createSession({ ephemeral: true })
    const sessionDir = getSessionDir(sess.id)
    
    // Session directory should not exist
    expect(existsSync(sessionDir)).toBe(false)
    
    // Verify tmpDir exists but does not contain this session
    const allDirs = readdirSync(tmpDir)
    expect(allDirs).not.toContain(sess.id)
  })

  test("createSession() without ephemeral flag DOES create files on disk", () => {
    const sess = createSession()
    const sessionDir = getSessionDir(sess.id)
    
    // Session directory should exist
    expect(existsSync(sessionDir)).toBe(true)
    
    // Should contain session.jsonl
    expect(existsSync(join(sessionDir, "session.jsonl"))).toBe(true)
    
    // Should contain meta.json
    expect(existsSync(join(sessionDir, "meta.json"))).toBe(true)
  })

  test("ephemeral session does NOT persist meta.json", () => {
    const sess = createSession({ ephemeral: true })
    const metaPath = join(getSessionDir(sess.id), "meta.json")
    
    expect(existsSync(metaPath)).toBe(false)
  })

  test("ephemeral session does NOT persist session.jsonl", () => {
    const sess = createSession({ ephemeral: true })
    const logPath = join(getSessionDir(sess.id), "session.jsonl")
    
    expect(existsSync(logPath)).toBe(false)
  })
})

describe("ephemeral session: listing", () => {
  test("listSessions() excludes ephemeral sessions", () => {
    const before = listSessions().length
    const ephemeral1 = createSession({ ephemeral: true })
    const ephemeral2 = createSession({ ephemeral: true })
    const regular = createSession()

    const after = listSessions()
    
    // Only the regular session should be added to the list
    expect(after.length).toBe(before + 1)
    expect(after.some((s) => s.id === regular.id)).toBe(true)
    expect(after.some((s) => s.id === ephemeral1.id)).toBe(false)
    expect(after.some((s) => s.id === ephemeral2.id)).toBe(false)
  })

  test("listAllSessions() excludes ephemeral sessions", () => {
    const before = listAllSessions().length
    const ephemeral = createSession({ ephemeral: true })
    const regular = createSession()

    const after = listAllSessions()
    
    // Only the regular session should be added
    expect(after.length).toBe(before + 1)
    expect(after.some((s) => s.id === regular.id)).toBe(true)
    expect(after.some((s) => s.id === ephemeral.id)).toBe(false)
  })

  test("multiple ephemeral sessions do not appear in any listing", () => {
    const beforeMain = listSessions().length
    const beforeAll = listAllSessions().length
    
    // Create several ephemeral sessions
    createSession({ ephemeral: true })
    createSession({ ephemeral: true })
    createSession({ ephemeral: true })

    const afterMain = listSessions()
    const afterAll = listAllSessions()
    
    // No change in any list
    expect(afterMain.length).toBe(beforeMain)
    expect(afterAll.length).toBe(beforeAll)
  })
})

describe("ephemeral session: prompt()", () => {
  test("prompt({ ephemeral: true }) creates ephemeral session that does not appear in listSessions()", async () => {
    const before = listSessions().length
    let capturedId: string | null = null
    
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      ephemeral: true,
      parts: [{ type: "text", text: "ephemeral test" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    
    // Session was created
    const sess = getSession(capturedId!)
    expect(sess.kind).toBe("ephemeral")
    
    // But does not appear in listings
    const after = listSessions()
    expect(after.length).toBe(before)
    expect(after.some((s) => s.id === capturedId)).toBe(false)
  })

  test("prompt({ ephemeral: true }) does not create files on disk", async () => {
    let capturedId: string | null = null
    
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      ephemeral: true,
      parts: [{ type: "text", text: "no disk write" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    
    const sessionDir = getSessionDir(capturedId!)
    expect(existsSync(sessionDir)).toBe(false)
  })

  test("prompt() without ephemeral flag creates persistent session", async () => {
    let capturedId: string | null = null
    
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      parts: [{ type: "text", text: "persistent test" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    
    // Session was created and persisted
    const sess = getSession(capturedId!)
    expect(sess.kind).toBe("main")
    
    // Appears in listing
    const sessions = listSessions()
    expect(sessions.some((s) => s.id === capturedId)).toBe(true)
    
    // Files exist on disk
    const sessionDir = getSessionDir(capturedId!)
    expect(existsSync(sessionDir)).toBe(true)
    expect(existsSync(join(sessionDir, "session.jsonl"))).toBe(true)
  })

  test("prompt({ ephemeral: true }) sets QUARK_SESSION_ID in process.env", async () => {
    delete process.env.QUARK_SESSION_ID

    let capturedId = ""
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      ephemeral: true,
      parts: [{ type: "text", text: "env test" }],
    }).catch(() => {})

    expect(capturedId.length).toBeGreaterThan(0)
    expect(String(process.env.QUARK_SESSION_ID)).toBe(capturedId)
  })

  test("prompt({ ephemeral: true, parentSessionId }) preserves the parent link", async () => {
    const parent = createSession()
    let capturedId = ""
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      parentSessionId: parent.id,
      ephemeral: true,
      parts: [{ type: "text", text: "child task" }],
    }).catch(() => {})

    const child = getSession(capturedId)
    expect(child.kind).toBe("ephemeral")
    expect(child.parentSessionId).toBe(parent.id)
  })
})

describe("ephemeral session: in-memory lifecycle", () => {
  test("ephemeral session can be retrieved immediately after creation", () => {
    const sess = createSession({ ephemeral: true })
    const retrieved = getSession(sess.id)
    
    expect(retrieved).not.toBeNull()
    expect(retrieved.id).toBe(sess.id)
    expect(retrieved.kind).toBe("ephemeral")
  })

  test("ephemeral session has valid timestamps", () => {
    const before = Date.now()
    const sess = createSession({ ephemeral: true })
    const after = Date.now()
    
    expect(sess.timeCreated).toBeGreaterThanOrEqual(before)
    expect(sess.timeCreated).toBeLessThanOrEqual(after)
    expect(sess.timeUpdated).toBe(sess.timeCreated)
  })

  test("ephemeral session preserves directory and title fields", () => {
    const sess = createSession({
      ephemeral: true,
      directory: "/test/dir",
    })
    
    expect(sess.directory).toBe("/test/dir")
    expect(sess.title).toBeNull() // Default null until set
  })

  test("ephemeral session with parentSessionId retains parent reference", () => {
    const parent = createSession()
    const ephemeralChild = createSession({
      ephemeral: true,
      parentSessionId: parent.id,
    })
    
    expect(ephemeralChild.parentSessionId).toBe(parent.id)
    expect(ephemeralChild.kind).toBe("ephemeral")
  })
})

describe("ephemeral session: isolation from persistent sessions", () => {
  test("ephemeral and persistent sessions coexist independently", () => {
    const regular1 = createSession()
    const ephemeral1 = createSession({ ephemeral: true })
    const regular2 = createSession()
    const ephemeral2 = createSession({ ephemeral: true })
    
    // Both regular sessions appear in listings
    const listed = listSessions()
    expect(listed.some((s) => s.id === regular1.id)).toBe(true)
    expect(listed.some((s) => s.id === regular2.id)).toBe(true)
    
    // No ephemeral sessions appear
    expect(listed.some((s) => s.id === ephemeral1.id)).toBe(false)
    expect(listed.some((s) => s.id === ephemeral2.id)).toBe(false)
    
    // But all can be retrieved via getSession
    expect(getSession(regular1.id)).not.toBeNull()
    expect(getSession(ephemeral1.id)).not.toBeNull()
    expect(getSession(regular2.id)).not.toBeNull()
    expect(getSession(ephemeral2.id)).not.toBeNull()
  })

  test("only persistent sessions create disk artifacts", () => {
    const regular = createSession()
    const ephemeral = createSession({ ephemeral: true })
    
    // Check disk state
    const regularDir = getSessionDir(regular.id)
    const ephemeralDir = getSessionDir(ephemeral.id)
    
    expect(existsSync(regularDir)).toBe(true)
    expect(existsSync(ephemeralDir)).toBe(false)
    
    // Count actual directories in tmpDir
    const dirs = readdirSync(tmpDir)
    expect(dirs).toContain(regular.id)
    expect(dirs).not.toContain(ephemeral.id)
  })
})
