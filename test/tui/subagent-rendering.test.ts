// Tests for sub-agent rendering in the TUI state layer

import { describe, test, expect } from "bun:test"
import { createRoot } from "solid-js"
import { createAppState, dbToTuiMessages, dispatch } from "../../src/tui/state"
import { dbToConversationMessages } from "../../src/shared/conversation-view"
import type { MessageRow, PartRow } from "../../src/session/message"

function withRoot<T>(fn: () => T): T {
  let result!: T
  createRoot((dispose) => {
    result = fn()
    dispose()
  })
  return result
}

describe("dispatch: sub-agent eager init at tool-input", () => {
  test("first-class subagent tool input eagerly initializes subAgent", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "subagent", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { profile: "finder", prompt: "explore" },
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.profile).toBe("finder")
      expect(part.subAgent.modelName).toBeDefined()
      expect(part.subAgent.tokenLimit).toBeNumber()
      expect(part.subAgent.tokenLimit).toBeGreaterThanOrEqual(0)
      expect(part.subAgent.tools).toEqual([])
      expect(part.subAgent.done).toBe(false)
    })
  })

  test("new execution does not inspect legacy Bash command strings", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: 'quark --sub-agent --profile finder --prompt "explore"' },
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeUndefined()
    })
  })

  test("tool-input with non-bash tool does NOT initialize subAgent", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "read", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { path: "/some/file.ts" },
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeUndefined()
    })
  })
})

describe("dispatch: sub-agent observability", () => {
  test("attaches subAgent state to parent bash tool parts", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      dispatch(state, {
        type: "subagent-tool-start",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tool: "read",
        callId: "child-1",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.profile).toBe("finder")
      expect(part.subAgent.tools).toHaveLength(1)
      expect(part.subAgent.tools[0].tool).toBe("read")
      expect(part.subAgent.tools[0].callId).toBe("child-1")
    })
  })

  test("creates subAgent state via step-finish before any tool-start", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      // step-finish can arrive before any subagent-tool-start
      dispatch(state, {
        type: "subagent-step-finish",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tokens: { input: 1000, output: 200 },
        tokenLimit: 128000,
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.profile).toBe("finder")
      expect(part.subAgent.tokensUsed).toBe(1000)
      expect(part.subAgent.tokenLimit).toBe(128000)
    })
  })

  test("text-delta updates subAgent textPreview on existing tool part", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      dispatch(state, {
        type: "subagent-text-delta",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        text: "working on it",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.textPreview).toBe("working on it")
    })
  })

  test("subagent-done marks subAgent as done", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      dispatch(state, {
        type: "subagent-tool-start",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tool: "read",
        callId: "child-1",
      })
      dispatch(state, {
        type: "subagent-done",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent.done).toBe(true)
    })
  })

  test("nested lifecycle is pending to awaiting approval to running", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "subagent", callId: "parent-1" })
      dispatch(state, {
        type: "subagent-tool-start",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tool: "read",
        callId: "child-1",
      })
      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent.tools[0].status).toBe("pending")

      dispatch(state, {
        type: "subagent-tool-input",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tool: "read",
        callId: "child-1",
        input: { path: "/tmp/file" },
      })
      expect(part.subAgent.tools[0].status).toBe("awaiting_approval")

      dispatch(state, {
        type: "subagent-tool-running",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        callId: "child-1",
      })
      expect(part.subAgent.tools[0].status).toBe("running")
    })
  })

  test("stores structured child failures on the subagent card", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "subagent", callId: "parent-1" })
      dispatch(state, {
        type: "subagent-error",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        kind: "provider",
        message: "API unavailable",
      })
      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent.error).toEqual({ kind: "provider", message: "API unavailable" })
    })
  })
})

describe("persisted subagent replay", () => {
  const messages: MessageRow[] = [{
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    modelId: "model",
    providerId: "provider",
    finish: "tool-calls",
    cost: null,
    tokensIn: null,
    tokensOut: null,
    timeCreated: 1,
    timeCompleted: 2,
  }]

  function replay(data: Record<string, unknown>): { tui: any; shared: any } {
    const parts: PartRow[] = [{
      id: "p1",
      messageId: "m1",
      sessionId: "s1",
      type: "tool",
      data: JSON.stringify(data),
    }]
    return {
      tui: (dbToTuiMessages(messages, parts)[0]!.parts[0] as any).subAgent,
      shared: (dbToConversationMessages(messages, parts)[0]!.parts[0] as any).subAgent,
    }
  }

  test("reconstructs first-class calls from structured input and metadata", () => {
    const result = replay({
      tool: "subagent",
      callId: "call-1",
      status: "completed",
      input: { profile: "finder", prompt: "inspect auth" },
      output: "done",
      subAgent: { profile: "finder", prompt: "inspect auth", modelName: "test/model", tokenLimit: 1000 },
    })
    expect(result.tui).toMatchObject({ profile: "finder", prompt: "inspect auth", modelName: "test/model", done: true })
    expect(result.shared).toMatchObject({ profile: "finder", prompt: "inspect auth", modelName: "test/model", done: true })
  })

  test("keeps legacy Bash replay compatibility without using it for live execution", () => {
    const result = replay({
      tool: "bash",
      callId: "call-1",
      status: "completed",
      input: { command: 'quark --sub-agent --profile finder --prompt "legacy task"' },
      output: "done",
    })
    expect(result.tui).toMatchObject({ profile: "finder", prompt: "legacy task", done: true })
    expect(result.shared).toMatchObject({ profile: "finder", prompt: "legacy task", done: true })
  })
})
