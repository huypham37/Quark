import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { createSession, updateSession } from "../../src/session/session"
import { createTask, setTaskStorageRoot } from "../../src/task/task"
import { createBranch } from "../../src/session/branch"
import { readSessionTool } from "../../src/tool/read_session"

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
  sessionDir = mkdtempSync(join(tmpdir(), "quark-test-readsession-session-"))
  taskDir = mkdtempSync(join(tmpdir(), "quark-test-readsession-task-"))
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

describe("read_session tool", () => {
  test("returns summary for a session with summary", async () => {
    const task = createTask({
      title: "Read test",
      description: "Test read session tool",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, {
      title: "Test Session",
      summary: "Implemented the read_session tool with full test coverage",
    })

    const result = await readSessionTool.execute({ sessionId: session.id }, ctx())

    expect(result.metadata.hasSummary).toBe(true)
    expect(result.output).toContain("Implemented the read_session tool with full test coverage")
    expect(result.output).toContain("Test read session tool")
  })

  test("reports no summary for session without one", async () => {
    const session = createSession()

    const result = await readSessionTool.execute({ sessionId: session.id }, ctx())

    expect(result.metadata.hasSummary).toBe(false)
    expect(result.output).toContain("has no summary or task context")
  })

  test("resolves session by prefix", async () => {
    const task = createTask({
      title: "Prefix test",
      description: "Test prefix resolution",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, { summary: "Prefix-resolved summary" })

    const prefix = session.id.slice(0, 8)
    const result = await readSessionTool.execute({ sessionId: prefix }, ctx())

    expect(result.metadata.sessionId).toBe(session.id)
    expect(result.output).toContain("Prefix-resolved summary")
  })

  test("includes task description in lineage context", async () => {
    const task = createTask({
      title: "Lineage test",
      description: "Build session context tools for task-first architecture",
      profile: "coder",
    })
    const session = createSession({ taskId: task.id })
    updateSession(session.id, { summary: "Root work done" })

    const result = await readSessionTool.execute({ sessionId: session.id }, ctx())

    expect(result.output).toContain("Build session context tools for task-first architecture")
  })

  test("walks full lineage across branches", async () => {
    const task = createTask({
      title: "Deep lineage",
      description: "Multi-branch task with nested summaries",
      profile: "coder",
    })

    const root = createSession({ taskId: task.id })

    const child = createBranch({
      sessionId: root.id,
      summary: "Root: built foundation",
      profile: "coder",
    })

    const grandchild = createBranch({
      sessionId: child.sessionId,
      summary: "Child: added features",
      profile: "coder",
    })

    // Update grandchild with its own summary
    updateSession(grandchild.sessionId, { summary: "Grandchild: fixed edge cases" })

    const result = await readSessionTool.execute({ sessionId: grandchild.sessionId }, ctx())

    expect(result.output).toContain("Root: built foundation")
    expect(result.output).toContain("Child: added features")
    expect(result.output).toContain("Grandchild: fixed edge cases")
    expect(result.output).toContain("Multi-branch task with nested summaries")
  })

  test("throws for non-existent session ID", async () => {
    await expect(
      readSessionTool.execute({ sessionId: "nonexistent_id_12345" }, ctx()),
    ).rejects.toThrow()
  })
})
