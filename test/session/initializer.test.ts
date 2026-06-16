import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { createSession, getSession } from "../../src/session/session"
import {
  buildInitializerPrompt,
  initializeSessionFromMessage,
  parseInitializerText,
} from "../../src/session/initializer"
import { getTask, listTasks, setTaskStorageRoot } from "../../src/task/task"

let sessionDir: string
let taskDir: string

beforeAll(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "quark-test-init-session-"))
  taskDir = mkdtempSync(join(tmpdir(), "quark-test-init-task-"))
  setSessionStorageRoot(sessionDir)
  setTaskStorageRoot(taskDir)
  ensureStorageRoot()
})

beforeEach(() => {
  rmSync(taskDir, { recursive: true, force: true })
  setTaskStorageRoot(taskDir)
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  setTaskStorageRoot(undefined)
  rmSync(sessionDir, { recursive: true, force: true })
  rmSync(taskDir, { recursive: true, force: true })
})

describe("SessionInitializer", () => {
  test("builds the structured JSON prompt", () => {
    const prompt = buildInitializerPrompt("Add JWT refresh token rotation")

    expect(prompt).toContain("Return ONLY valid JSON")
    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"task"')
  })

  test("validates initializer JSON output", () => {
    const parsed = parseInitializerText(
      '{"title":"Auth Token Rotation","task":"Add JWT refresh token rotation support"}',
    )

    expect(parsed).toEqual({
      title: "Auth Token Rotation",
      task: "Add JWT refresh token rotation support",
    })
    expect(parseInitializerText('{"title":"","task":"x"}')).toBeNull()
    expect(parseInitializerText("not json")).toBeNull()
  })

  test("fallback initializer creates a task and links the session", () => {
    const session = createSession()

    initializeSessionFromMessage({
      sessionId: session.id,
      message: "Add task-first storage",
      profile: "coder",
    })

    const tasks = listTasks()
    const updated = getSession(session.id)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.description).toBe("Add task-first storage")
    expect(updated.title).toBe("Add task-first storage")
    expect(updated.taskId).toBe(tasks[0]!.id)
  })

  test("is idempotent — does not create a second task if session already has one", () => {
    const session = createSession()

    initializeSessionFromMessage({
      sessionId: session.id,
      message: "First message",
      profile: "coder",
    })
    const firstTaskId = getSession(session.id).taskId

    initializeSessionFromMessage({
      sessionId: session.id,
      message: "Second message — should be ignored",
      profile: "coder",
    })

    expect(listTasks()).toHaveLength(1)
    expect(getSession(session.id).taskId).toBe(firstTaskId)
  })

  test("upgradeSessionTitle updates task title from LLM output", async () => {
    mock.module("ai", () => ({
      generateText: mock(async () => ({
        text: '{"title":"Login Redirect Fix","task":"Fix the login redirect loop in the auth middleware"}',
      })),
      generateId: () => "mock-id",
    }))

    const { upgradeSessionTitle } = await import("../../src/session/initializer")

    const session = createSession()

    initializeSessionFromMessage({
      sessionId: session.id,
      message: "Fix login bug",
      profile: "coder",
    })

    const taskId = getSession(session.id).taskId!
    const taskBefore = getTask(taskId)
    expect(taskBefore!.title).toBe("Fix login bug")

    const mockModel = {} as any
    await upgradeSessionTitle({
      sessionId: session.id,
      message: "Fix login bug",
      model: mockModel,
    })

    const taskAfter = getTask(taskId)
    expect(taskAfter!.title).toBe("Fix the login redirect loop in the auth middleware")

    mock.module("ai", () => require("ai"))
  })

  test("upgradeSessionTitle is NOT idempotent — calling it again overwrites the task title", async () => {
    mock.module("ai", () => ({
      generateText: mock(async () => ({
        text: '{"title":"Login Redirect Fix","task":"Fix the login redirect loop"}',
      })),
      generateId: () => "mock-id",
    }))

    const { upgradeSessionTitle } = await import("../../src/session/initializer")

    const session = createSession()

    initializeSessionFromMessage({
      sessionId: session.id,
      message: "Fix login bug",
      profile: "coder",
    })

    const taskId = getSession(session.id).taskId!

    const mockModel = {} as any
    await upgradeSessionTitle({ sessionId: session.id, message: "Fix login bug", model: mockModel })
    expect(getTask(taskId)!.title).toBe("Fix the login redirect loop")

    // Second call with different LLM output — the function itself has no
    // idempotency guard, so it overwrites. This is why the call site in
    // prompt.ts must guard against repeated invocations.
    mock.module("ai", () => ({
      generateText: mock(async () => ({
        text: '{"title":"Something Else","task":"Do something completely different"}',
      })),
      generateId: () => "mock-id",
    }))

    const { upgradeSessionTitle: upgradeSessionTitle2 } = await import("../../src/session/initializer")
    await upgradeSessionTitle2({ sessionId: session.id, message: "Do something else", model: mockModel })
    expect(getTask(taskId)!.title).toBe("Do something completely different")

    mock.module("ai", () => require("ai"))
  })
})
