// Sub-agent session tests
//
// Verifies:
// - createSession() with parentSessionId creates a child session with kind=subagent
// - listSessions() excludes sub-agent sessions (only top-level)
// - listAllSessions() includes everything
// - listChildSessions() returns only children of a given parent
// - prompt() with parentSessionId creates a child session
// - ATOM_SESSION_ID is set in process.env after prompt()
//
// DB is initialised with an in-memory SQLite instance.

import { describe, test, expect, beforeAll, afterEach } from "bun:test"
import { getDB } from "../../src/storage/db"
import { prompt } from "../../src/session/prompt"
import {
  createSession,
  getSession,
  listSessions,
  listAllSessions,
  listChildSessions,
} from "../../src/session/session"
import { bus } from "../../src/session/events"
import { bootstrap, resetBootstrap } from "../../src/bootstrap"

beforeAll(async () => {
  getDB(":memory:")
  resetBootstrap()
  await bootstrap()
})

afterEach(() => {
  bus.removeAllListeners()
})

describe("sub-agent session: schema", () => {
  test("createSession() defaults to kind=main with no parentSessionId", () => {
    const sess = createSession()
    expect(sess.kind).toBe("main")
    expect(sess.parentSessionId).toBeNull()
  })

  test("createSession() with parentSessionId sets kind=subagent", () => {
    const parent = createSession()
    const child = createSession({ parentSessionId: parent.id })
    expect(child.kind).toBe("subagent")
    expect(child.parentSessionId).toBe(parent.id)
  })

  test("createSession() with explicit kind overrides auto-detection", () => {
    const parent = createSession()
    const child = createSession({ parentSessionId: parent.id, kind: "main" })
    expect(child.kind).toBe("main")
    expect(child.parentSessionId).toBe(parent.id)
  })

  test("getSession() returns parentSessionId and kind", () => {
    const parent = createSession()
    const child = createSession({ parentSessionId: parent.id })
    const fetched = getSession(child.id)
    expect(fetched.parentSessionId).toBe(parent.id)
    expect(fetched.kind).toBe("subagent")
  })
})

describe("sub-agent session: listing", () => {
  test("listSessions() excludes sub-agent sessions", () => {
    const before = listSessions().length
    const parent = createSession()
    createSession({ parentSessionId: parent.id })
    createSession({ parentSessionId: parent.id })

    const after = listSessions()
    // Only the parent should be added to the top-level list
    expect(after.length).toBe(before + 1)
    expect(after.some((s) => s.id === parent.id)).toBe(true)
  })

  test("listAllSessions() includes both main and sub-agent sessions", () => {
    const before = listAllSessions().length
    const parent = createSession()
    const child = createSession({ parentSessionId: parent.id })

    const after = listAllSessions()
    expect(after.length).toBe(before + 2)
    expect(after.some((s) => s.id === parent.id)).toBe(true)
    expect(after.some((s) => s.id === child.id)).toBe(true)
  })

  test("listChildSessions() returns only children of given parent", () => {
    const parent1 = createSession()
    const parent2 = createSession()
    const child1a = createSession({ parentSessionId: parent1.id })
    const child1b = createSession({ parentSessionId: parent1.id })
    createSession({ parentSessionId: parent2.id })

    const children = listChildSessions(parent1.id)
    expect(children.length).toBe(2)
    const childIds = children.map((c) => c.id)
    expect(childIds).toContain(child1a.id)
    expect(childIds).toContain(child1b.id)
  })

  test("listChildSessions() returns empty for session with no children", () => {
    const parent = createSession()
    expect(listChildSessions(parent.id)).toHaveLength(0)
  })
})

describe("sub-agent session: prompt()", () => {
  test("prompt() with parentSessionId creates a child session", async () => {
    const parent = createSession()
    let capturedId: string | null = null
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      parentSessionId: parent.id,
      parts: [{ type: "text", text: "research this" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    const child = getSession(capturedId!)
    expect(child.parentSessionId).toBe(parent.id)
    expect(child.kind).toBe("subagent")
  })

  test("prompt() sets ATOM_SESSION_ID in process.env", async () => {
    delete process.env.ATOM_SESSION_ID

    let capturedId = ""
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      parts: [{ type: "text", text: "hello" }],
    }).catch(() => {})

    expect(capturedId.length).toBeGreaterThan(0)
    expect(String(process.env.ATOM_SESSION_ID)).toBe(capturedId)
  })

  test("prompt() without parentSessionId creates a main session", async () => {
    let capturedId: string | null = null
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await prompt({
      parts: [{ type: "text", text: "hello" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    const sess = getSession(capturedId!)
    expect(sess.kind).toBe("main")
    expect(sess.parentSessionId).toBeNull()
  })
})
