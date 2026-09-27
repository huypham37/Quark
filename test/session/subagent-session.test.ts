// Sub-agent session tests
//
// Verifies:
// - createSession() with parentSessionId creates a child session with kind=subagent
// - listSessions() excludes sub-agent sessions (only top-level)
// - listAllSessions() includes everything
// - listChildSessions() returns only children of a given parent
// - prompt() with parentSessionId creates a child session
// - instance prompts do not mutate process-global session state
//
// Session storage is redirected to an in-memory JSONL temp directory.

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { createJsonlSessionStore } from "../../packages/runner/src/session/session"
import { createRunner, type Runner } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import {
  createSession,
  getSession,
  listSessions,
  listAllSessions,
  listChildSessions,
} from "../../packages/runner/src/session/session"

let tmpDir: string
let runner: Runner

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-subagent-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
  runner = createRunner({
    agent: defineAgent({ id: "test", instructions: "test", tools: [], model: "invalid/nonexistent" }),
    store: createJsonlSessionStore(tmpDir),
  })
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  runner.bus.removeAllListeners()
})

describe("sub-agent session: schema", () => {
  test("createSession() defaults to kind=main with no parentSessionId", () => {
    const sess = createSession(undefined, runner.store)
    expect(sess.kind).toBe("main")
    expect(sess.parentSessionId).toBeNull()
  })

  test("createSession() with parentSessionId sets kind=subagent", () => {
    const parent = createSession(undefined, runner.store)
    const child = createSession({ parentSessionId: parent.id }, runner.store)
    expect(child.kind).toBe("subagent")
    expect(child.parentSessionId).toBe(parent.id)
  })

  test("createSession() with explicit kind overrides auto-detection", () => {
    const parent = createSession(undefined, runner.store)
    const child = createSession({ parentSessionId: parent.id, kind: "main" }, runner.store)
    expect(child.kind).toBe("main")
    expect(child.parentSessionId).toBe(parent.id)
  })

  test("getSession() returns parentSessionId and kind", () => {
    const parent = createSession(undefined, runner.store)
    const child = createSession({ parentSessionId: parent.id }, runner.store)
    const fetched = getSession(child.id, runner.store)
    expect(fetched.parentSessionId).toBe(parent.id)
    expect(fetched.kind).toBe("subagent")
  })
})

describe("sub-agent session: listing", () => {
  test("listSessions() excludes sub-agent sessions", () => {
    const before = listSessions(runner.store).length
    const parent = createSession(undefined, runner.store)
    createSession({ parentSessionId: parent.id }, runner.store)
    createSession({ parentSessionId: parent.id }, runner.store)

    const after = listSessions(runner.store)
    // Only the parent should be added to the top-level list
    expect(after.length).toBe(before + 1)
    expect(after.some((s) => s.id === parent.id)).toBe(true)
  })

  test("listAllSessions() includes both main and sub-agent sessions", () => {
    const before = listAllSessions(runner.store).length
    const parent = createSession(undefined, runner.store)
    const child = createSession({ parentSessionId: parent.id }, runner.store)

    const after = listAllSessions(runner.store)
    expect(after.length).toBe(before + 2)
    expect(after.some((s) => s.id === parent.id)).toBe(true)
    expect(after.some((s) => s.id === child.id)).toBe(true)
  })

  test("listChildSessions() returns only children of given parent", () => {
    const parent1 = createSession(undefined, runner.store)
    const parent2 = createSession(undefined, runner.store)
    const child1a = createSession({ parentSessionId: parent1.id }, runner.store)
    const child1b = createSession({ parentSessionId: parent1.id }, runner.store)
    createSession({ parentSessionId: parent2.id }, runner.store)

    const children = listChildSessions(parent1.id, runner.store)
    expect(children.length).toBe(2)
    const childIds = children.map((c) => c.id)
    expect(childIds).toContain(child1a.id)
    expect(childIds).toContain(child1b.id)
  })

  test("listChildSessions() returns empty for session with no children", () => {
    const parent = createSession(undefined, runner.store)
    expect(listChildSessions(parent.id, runner.store)).toHaveLength(0)
  })
})

describe("sub-agent session: prompt()", () => {
  test("instance prompt leaves the process-global session ID unchanged", async () => {
    const before = process.env.QUARK_SESSION_ID
    const created: string[] = []
    runner.bus.on("session-created", ({ sessionId }) => created.push(sessionId))
    await runner.prompt({ parts: [{ type: "text", text: "hello" }] }).catch(() => {})
    expect(created).toHaveLength(1)
    expect(process.env.QUARK_SESSION_ID).toBe(before)
  })

  test("prompt() with parentSessionId creates a child session", async () => {
    const parent = createSession(undefined, runner.store)
    let capturedId: string | null = null
    runner.bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await runner.prompt({
      parentSessionId: parent.id,
      parts: [{ type: "text", text: "research this" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    const child = getSession(capturedId!, runner.store)
    expect(child.parentSessionId).toBe(parent.id)
    expect(child.kind).toBe("subagent")
  })

  test("prompt() without parentSessionId creates a main session", async () => {
    let capturedId: string | null = null
    runner.bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    await runner.prompt({
      parts: [{ type: "text", text: "hello" }],
    }).catch(() => {})

    expect(capturedId).not.toBeNull()
    const sess = getSession(capturedId!, runner.store)
    expect(sess.kind).toBe("main")
    expect(sess.parentSessionId).toBeNull()
  })
})
