import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { createSession, getSession, listSessions, updateSession } from "../../src/session/session"
import { loadMessages } from "../../src/session/message"
import {
  buildLineageContext,
  createBranch,
  extractLastUserText,
  getSessionLineage,
  shouldBranchWithRealTokens,
} from "../../src/session/branch"
import { createTask, setTaskStorageRoot } from "../../src/task/task"

let sessionDir: string
let taskDir: string

beforeAll(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "quark-test-branch-session-"))
  taskDir = mkdtempSync(join(tmpdir(), "quark-test-branch-task-"))
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

describe("session branching", () => {
  test("creates a main child branch with frozen parent summary", () => {
    const task = createTask({
      title: "Task first storage",
      description: "Implement task-first storage",
      profile: "coder",
    })
    const parent = createSession({ taskId: task.id })
    updateSession(parent.id, { filesModified: ["src/session/session.ts"] })

    const result = createBranch({
      sessionId: parent.id,
      summary: "Added task metadata",
      prompt: "Continue with branching",
      profile: "coder",
    })

    const updatedParent = getSession(parent.id)
    const child = getSession(result.sessionId)

    expect(updatedParent.summary).toBe("Added task metadata")
    expect(child.kind).toBe("main")
    expect(child.parentSessionId).toBe(parent.id)
    expect(child.taskId).toBe(task.id)
    expect(child.parentSummary).toBe("Added task metadata")
    expect(child.filesModified).toEqual(["src/session/session.ts"])
    expect(listSessions().map((s) => s.id)).toContain(child.id)
  })

  test("seeds child session with lineage context and current prompt", () => {
    const task = createTask({
      title: "Branch context",
      description: "Keep context across branches",
      profile: "coder",
    })
    const parent = createSession({ taskId: task.id })

    const result = createBranch({
      sessionId: parent.id,
      summary: "Parent did the first half",
      prompt: "Finish the second half",
      profile: "coder",
    })

    const { messages, parts } = loadMessages(result.sessionId)
    const text = extractLastUserText(messages, parts)

    expect(text).toContain("Task: Keep context across branches")
    expect(text).toContain("Session")
    expect(text).toContain("Parent did the first half")
    expect(text).toContain("Current prompt:\nFinish the second half")
  })

  test("walks lineage from root to child", () => {
    const root = createSession()
    const child = createBranch({
      sessionId: root.id,
      summary: "Root summary",
      prompt: "Next",
      profile: "coder",
    })
    const grandchild = createBranch({
      sessionId: child.sessionId,
      summary: "Child summary",
      prompt: "Next again",
      profile: "coder",
    })

    const lineage = getSessionLineage(grandchild.sessionId)
    const context = buildLineageContext(grandchild.sessionId)

    expect(lineage.map((s) => s.id)).toEqual([root.id, child.sessionId, grandchild.sessionId])
    expect(context).toContain("Root summary")
    expect(context).toContain("Child summary")
  })

  test("sibling branches share frozen parent summary; second branch does not overwrite parent", () => {
    const task = createTask({
      title: "Sibling snapshot",
      description: "Siblings share the same parent summary",
      profile: "coder",
    })
    const parent = createSession({ taskId: task.id })

    const first = createBranch({
      sessionId: parent.id,
      summary: "First snapshot — written by initial steer",
      prompt: "Path A",
      profile: "coder",
    })
    const parentAfterFirst = getSession(parent.id)
    expect(parentAfterFirst.summary).toBe("First snapshot — written by initial steer")

    // Second branch attempts to overwrite with a different summary.
    const second = createBranch({
      sessionId: parent.id,
      summary: "Second LLM call — should be ignored",
      prompt: "Path B",
      profile: "coder",
    })

    const parentAfterSecond = getSession(parent.id)
    const childA = getSession(first.sessionId)
    const childB = getSession(second.sessionId)

    // Parent summary is frozen after the first branch.
    expect(parentAfterSecond.summary).toBe("First snapshot — written by initial steer")
    // Both siblings share the same parentSummary snapshot.
    expect(childA.parentSummary).toBe("First snapshot — written by initial steer")
    expect(childB.parentSummary).toBe("First snapshot — written by initial steer")
    expect(childA.parentSummary).toBe(childB.parentSummary!)
    // BranchResult also reports the snapshot value, not the discarded input.
    expect(second.summary).toBe("First snapshot — written by initial steer")
  })

  test("detects branch pressure using real tokens before estimates", () => {
    const result = shouldBranchWithRealTokens(
      "",
      [{ role: "user", content: "x".repeat(10000) }],
      { context: 10000, output: 1000 },
      0.9,
      [
        {
          id: "p1",
          messageId: "m1",
          sessionId: "s1",
          type: "step-finish",
          data: JSON.stringify({ reason: "stop", tokens: { input: 9500 } }),
        },
      ],
    )

    expect(result).toBe(true)
  })
})
