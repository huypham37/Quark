// Tests for sub-agent rendering in the TUI state layer

import { describe, test, expect } from "bun:test"
import { createRoot } from "solid-js"
import { createAppState, dispatch } from "../../src/tui/state"

function withRoot<T>(fn: () => T): T {
  let result!: T
  createRoot((dispose) => {
    result = fn()
    dispose()
  })
  return result
}

describe("dispatch: sub-agent eager init at tool-input", () => {
  test("tool-input with quark --sub-agent command eagerly initializes subAgent", () => {
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
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.profile).toBe("finder")
      expect(part.subAgent.modelName).toBeDefined()
      expect(part.subAgent.tokenLimit).toBeGreaterThan(0)
      expect(part.subAgent.tools).toEqual([])
      expect(part.subAgent.done).toBe(false)
    })
  })

  test("tool-input with non-sub-agent command does NOT initialize subAgent", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: "ls -la" },
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
})
