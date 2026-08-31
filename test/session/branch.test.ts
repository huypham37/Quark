import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { createSession, getSession, listSessions, updateSession } from "../../src/session/session"
import {
  addPart,
  createAssistantMessage,
  finishMessage,
  loadMessages,
  saveUserMessage,
} from "../../src/session/message"
import {
  buildLineageContext,
  compactBranch,
  createSteerBranch,
  createBranch,
  extractLastUserText,
  getSessionLineage,
  shouldBranchWithRealTokens,
} from "../../src/session/branch"
let sessionDir: string

beforeAll(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "quark-test-branch-session-"))
  setSessionStorageRoot(sessionDir)
  ensureStorageRoot()
})

beforeEach(() => {
  rmSync(sessionDir, { recursive: true, force: true })
  setSessionStorageRoot(sessionDir)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(sessionDir, { recursive: true, force: true })
})

describe("session branching", () => {
  test("creates a main child branch with frozen parent summary", () => {
    const parent = createSession()
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
    expect(child.parentSummary).toBe("Added task metadata")
    expect(child.filesModified).toEqual(["src/session/session.ts"])
    expect(listSessions().map((s) => s.id)).toContain(child.id)
  })

  test("seeds child session with lineage context and prompt", () => {
    const parent = createSession()

    const result = createBranch({
      sessionId: parent.id,
      summary: "Parent did the first half",
      prompt: "Finish the second half",
      profile: "coder",
    })

    const { messages, parts } = loadMessages(result.sessionId)
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => (JSON.parse(p.data) as { text: string }).text)
      .join("\n")
    const lastUser = extractLastUserText(messages, parts)
    const lastText = parts
      .filter((part) => part.type === "text")
      .at(-1)

    expect(text).toContain("Session")
    expect(text).toContain("Parent did the first half")
    expect(lastUser).toBe("Finish the second half")
    expect(result.promptMessageId).toBe(lastText!.messageId)
    expect(JSON.parse(lastText!.data)).toEqual({
      text: "Finish the second half",
      variant: "steer",
    })
  })

  test("replays recent context without tool/runtime parts", () => {
    const parent = createSession()

    saveUserMessage({ sessionId: parent.id, text: "Inspect src/session/branch.ts" })
    const assistant = createAssistantMessage({ sessionId: parent.id })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "text",
      data: { text: "I inspected the file." },
    })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "tool",
      data: {
        tool: "read",
        callId: "call_1",
        status: "completed",
        input: { path: "src/session/branch.ts" },
        output: "large tool output",
      },
    })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "step-finish",
      data: { reason: "stop", tokens: { input: 100, output: 10 } },
    })
    finishMessage(assistant.id, "stop", undefined, parent.id)

    const recent = loadMessages(parent.id)
    const result = createBranch({
      sessionId: parent.id,
      summary: "Older work summary",
      profile: "coder",
      recentMessages: recent.messages,
      recentParts: recent.parts,
    })

    const child = loadMessages(result.sessionId)
    expect(child.parts.some((p) => p.type === "tool")).toBe(false)
    expect(child.parts.some((p) => p.type === "step-finish")).toBe(false)
    expect(extractLastUserText(child.messages, child.parts)).toBe("Inspect src/session/branch.ts")
    expect(result.replayedMessageIds?.[recent.messages[0]!.id]).toBe(child.messages.at(-2)!.id)
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
    const parent = createSession()

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

  test("branches ephemeral sessions without persisting", () => {
    const parent = createSession({ ephemeral: true })
    saveUserMessage({ sessionId: parent.id, text: "Investigate the codebase" })

    const result = createBranch({
      sessionId: parent.id,
      summary: "Continue the investigation",
      profile: "finder",
    })
    const child = getSession(result.sessionId)
    const { messages } = loadMessages(child.id)

    expect(child.kind).toBe("ephemeral")
    expect(child.parentSessionId).toBe(parent.id)
    expect(child.parentSummary).toBe("Continue the investigation")
    expect(messages.length).toBeGreaterThan(0)
    expect(listSessions().some((session) => session.id === child.id)).toBe(false)
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

  test("compacts old history through the language model", async () => {
    const parent = createSession()
    for (let index = 1; index <= 5; index++) {
      saveUserMessage({ sessionId: parent.id, text: `Message ${index}` })
    }
    const history = loadMessages(parent.id)
    let calls = 0
    const model = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "compact-test",
      supportedUrls: {},
      async doGenerate() {
        calls++
        return {
          content: [{ type: "text", text: "## Context\nCompacted by the model" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      },
    } as any

    const result = await compactBranch({
      sessionId: parent.id,
      messages: history.messages,
      parts: history.parts,
      model,
      profile: "coder",
    })

    expect(calls).toBe(1)
    expect(result.summary).toContain("Compacted by the model")
    expect(getSession(result.sessionId).parentSessionId).toBe(parent.id)
    const child = loadMessages(result.sessionId)
    expect(extractLastUserText(child.messages, child.parts)).toBe("Message 5")
  })

  test("steers with full history and no compaction", () => {
    const parent = createSession()
    const user = saveUserMessage({ sessionId: parent.id, text: "Inspect the auth flow" })
    const assistant = createAssistantMessage({ sessionId: parent.id })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "text",
      data: { text: "I found the middleware." },
    })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "tool",
      data: {
        tool: "read",
        callId: "read_1",
        status: "completed",
        input: { path: "src/auth.ts" },
        output: "auth source",
      },
    })
    finishMessage(assistant.id, "stop", undefined, parent.id)
    const aborted = createAssistantMessage({ sessionId: parent.id })
    addPart({
      sessionId: parent.id,
      messageId: aborted.id,
      type: "text",
      data: { text: "Partial response" },
    })
    finishMessage(aborted.id, "aborted", undefined, parent.id)
    const history = loadMessages(parent.id)

    const result = createSteerBranch({
      sessionId: parent.id,
      prompt: "Use a cookie-based design",
      profile: "coder",
      messages: history.messages,
      parts: history.parts,
    })
    const childSession = getSession(result.sessionId)
    const child = loadMessages(result.sessionId)

    expect(getSession(parent.id).summary).toBeNull()
    expect(childSession.parentSummary).toBeNull()
    expect(child.messages).toHaveLength(3)
    expect(child.parts.some((part) => part.type === "tool")).toBe(true)
    expect(child.parts.some((part) => part.data.includes("Partial response"))).toBe(false)
    expect(extractLastUserText(child.messages, child.parts)).toBe("Use a cookie-based design")
    expect(result.replayedMessageIds?.[user.id]).toBe(child.messages[0]!.id)
  })

  test("forks with full history without a follow-up goal", () => {
    const parent = createSession()
    const user = saveUserMessage({ sessionId: parent.id, text: "Inspect the auth flow" })
    const assistant = createAssistantMessage({ sessionId: parent.id })
    addPart({
      sessionId: parent.id,
      messageId: assistant.id,
      type: "text",
      data: { text: "I found the middleware." },
    })
    finishMessage(assistant.id, "stop", undefined, parent.id)
    const history = loadMessages(parent.id)

    const result = createSteerBranch({
      sessionId: parent.id,
      profile: "coder",
      messages: history.messages,
      parts: history.parts,
    })
    const child = loadMessages(result.sessionId)

    expect(result.promptMessageId).toBeUndefined()
    expect(child.messages).toHaveLength(2)
    expect(extractLastUserText(child.messages, child.parts)).toBe("Inspect the auth flow")
    expect(result.replayedMessageIds?.[user.id]).toBe(child.messages[0]!.id)
  })
})
