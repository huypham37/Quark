import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { createSession, updateSession } from "../../src/session/session"
import { createTask, setTaskStorageRoot } from "../../src/task/task"
import { findSessionTool } from "../../src/tool/find_session"

let sessionDir: string
let taskDir: string

function ctx() {
  return {
    sessionId: "",
    messageId: "msg_1",
    callId: "call_1",
    abort: new AbortController().signal,
    ask: async () => {},
  }
}

beforeAll(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "quark-test-findsession-session-"))
  taskDir = mkdtempSync(join(tmpdir(), "quark-test-findsession-task-"))
  setSessionStorageRoot(sessionDir)
  setTaskStorageRoot(taskDir)
  ensureStorageRoot()
})

beforeEach(() => {
  rmSync(sessionDir, { recursive: true, force: true })
  rmSync(taskDir, { recursive: true, force: true })
  setSessionStorageRoot(sessionDir)
  setTaskStorageRoot(taskDir)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  setTaskStorageRoot(undefined)
  rmSync(sessionDir, { recursive: true, force: true })
  rmSync(taskDir, { recursive: true, force: true })
})

describe("find_session tool", () => {
  test("returns no matches for empty index", async () => {
    const result = await findSessionTool.execute({ query: "nothing" }, ctx())

    expect(result.title).toBe("No matches")
    expect(result.metadata.matches).toEqual([])
  })

  test("finds sessions by title match", async () => {
    const task = createTask({
      title: "Auth middleware",
      description: "Add JWT refresh token rotation",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, {
      title: "JWT Token Rotation",
      summary: "Built middleware structure, added token types",
    })

    const result = await findSessionTool.execute({ query: "JWT" }, ctx())

    expect(result.title).toBe("Found 1 session(s)")
    expect(result.metadata.matches).toHaveLength(1)
    expect(result.metadata.matches[0].sessionId).toBe(session.id)
  })

  test("finds sessions by summary match", async () => {
    const task = createTask({
      title: "Testing",
      description: "Add unit tests for session module",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, {
      title: "Session Tests",
      summary: "Added unit tests for session CRUD operations",
    })

    const result = await findSessionTool.execute({ query: "CRUD" }, ctx())

    expect(result.metadata.matches).toHaveLength(1)
    expect(result.metadata.matches[0].sessionId).toBe(session.id)
  })

  test("finds sessions by filesModified match", async () => {
    const task = createTask({
      title: "File work",
      description: "Work on files",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, {
      title: "Edit middleware",
      summary: "Refactored auth",
      filesModified: ["src/middleware/auth.ts", "src/types.ts"],
    })

    const result = await findSessionTool.execute({ query: "middleware" }, ctx())

    expect(result.metadata.matches).toHaveLength(1)
    expect(result.metadata.matches[0].sessionId).toBe(session.id)
  })

  test("scores partial word matches lower than exact matches", async () => {
    const task = createTask({
      title: "Scoring",
      description: "Test scoring",
      profile: "coder",
    })
    const exact = createSession({ taskId: task.id })
    updateSession(exact.id, { title: "JWT", summary: "Working on JWT tokens" })

    const partial = createSession({ taskId: task.id })
    updateSession(partial.id, { title: "Something", summary: "Mentioned JWT-related things" })

    const result = await findSessionTool.execute({ query: "JWT" }, ctx())

    expect(result.metadata.matches).toHaveLength(2)
    // Exact match should score higher
    expect(result.metadata.matches[0].sessionId).toBe(exact.id)
    expect(result.metadata.matches[0].score).toBeGreaterThan(result.metadata.matches[1].score)
  })

  test("scopes search to specified taskId", async () => {
    const taskA = createTask({
      title: "Task A",
      description: "Implement feature A",
      profile: "coder",
    })
    const taskB = createTask({
      title: "Task B",
      description: "Implement feature B",
      profile: "coder",
    })

    const sessionA = createSession({ taskId: taskA.id })
    updateSession(sessionA.id, { title: "JWT work", summary: "JWT tokens" })

    const sessionB = createSession({ taskId: taskB.id })
    updateSession(sessionB.id, { title: "JWT work", summary: "JWT tokens" })

    const result = await findSessionTool.execute({ query: "JWT", taskId: taskA.id }, ctx())

    expect(result.metadata.matches).toHaveLength(1)
    expect(result.metadata.matches[0].sessionId).toBe(sessionA.id)
  })

  test("scopes to current session's task when taskId omitted", async () => {
    const task = createTask({
      title: "Current task",
      description: "Current work",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, { title: "JWT work", summary: "JWT tokens" })

    // Create another session in a different task
    const otherTask = createTask({
      title: "Other task",
      description: "Other work",
      profile: "coder",
    })
    const otherSession = createSession({ taskId: otherTask.id })
    updateSession(otherSession.id, { title: "JWT work too", summary: "JWT tokens too" })

    const c = ctx()
    c.sessionId = session.id

    const result = await findSessionTool.execute({ query: "JWT" }, c)

    expect(result.metadata.matches).toHaveLength(1)
    expect(result.metadata.matches[0].sessionId).toBe(session.id)
  })

  test("decays score for older sessions", async () => {
    const task = createTask({
      title: "Decay test",
      description: "Test time decay",
      profile: "coder",
    })

    const recent = createSession({ taskId: task.id })
    updateSession(recent.id, {
      title: "JWT",
      summary: "JWT token work",
      timeUpdated: Date.now(),
    })

    const old = createSession({ taskId: task.id })
    updateSession(old.id, {
      title: "JWT",
      summary: "JWT token work",
      timeUpdated: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    })

    const result = await findSessionTool.execute({ query: "JWT" }, ctx())

    expect(result.metadata.matches).toHaveLength(2)
    expect(result.metadata.matches[0].sessionId).toBe(recent.id)
    // Recent score should be meaningfully higher (decayed old should be ~0.22x)
    expect(result.metadata.matches[0].score).toBeGreaterThan(result.metadata.matches[1].score * 2)
  })

  test("decay can flip ordering when old session has much higher keyword match", async () => {
    const task = createTask({
      title: "Flip test",
      description: "Test decay override",
      profile: "coder",
    })

    const recentWeak = createSession({ taskId: task.id })
    updateSession(recentWeak.id, {
      title: "JWT",
      summary: "some work",
      timeUpdated: Date.now(),
    })

    const oldStrong = createSession({ taskId: task.id })
    updateSession(oldStrong.id, {
      title: "JWT Tokens",
      summary: "JWT token implementation with rotation and refresh",
      timeUpdated: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    })

    const result = await findSessionTool.execute({ query: "JWT token" }, ctx())

    // oldStrong has more keyword matches but is older — keyword should still dominate moderate decay
    expect(result.metadata.matches[0].sessionId).toBe(oldStrong.id)
  })
})
