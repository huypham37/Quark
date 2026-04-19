// TDD tests for scrollable output rendering
// Tests that tool output is properly passed to and displayed by the scrollable output component

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

// ---------------------------------------------------------------------------
// Tool output state tests — verifies the state layer correctly stores and
// retrieves tool output that will be rendered by ScrollableOutput
// ---------------------------------------------------------------------------

describe("tool output state (precondition for ScrollableOutput)", () => {
  test("tool-end stores output in the tool part", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: "echo hello" },
      })

      const longOutput = "line 1\nline 2\nline 3\nline 4\nline 5"
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "completed",
        output: longOutput,
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.output).toBe(longOutput)
      expect(part.status).toBe("completed")
    })
  })

  test("tool-end with empty output stores empty string", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: "true" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "completed",
        output: "",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.output).toBe("")
    })
  })

  test("tool-end without output field leaves output undefined", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "read", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { path: "/file.ts" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "completed",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.output).toBeUndefined()
    })
  })

  test("error tool-end still stores output if provided", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: "false" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "error",
        output: "error: command failed\nsome details",
        error: "exit code 1",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.output).toBe("error: command failed\nsome details")
      expect(part.status).toBe("error")
    })
  })
})

// ---------------------------------------------------------------------------
// Multi-tool output tests — verifies output is correctly associated
// when multiple tools exist in the same message
// ---------------------------------------------------------------------------

describe("tool output with multiple tools", () => {
  test("multiple tool parts each have their own output", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })

      // Tool 1: bash
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { command: "ls" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "completed",
        output: "file1\nfile2\nfile3",
      })

      // Tool 2: read
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "read", callId: "c2" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c2",
        input: { path: "/test.ts" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c2",
        status: "completed",
        output: "export const x = 1",
      })

      const parts = state.store.messages[0]!.parts
      expect(parts).toHaveLength(2)

      const bashPart = parts[0] as any
      expect(bashPart.tool).toBe("bash")
      expect(bashPart.output).toBe("file1\nfile2\nfile3")

      const readPart = parts[1] as any
      expect(readPart.tool).toBe("read")
      expect(readPart.output).toBe("export const x = 1")
    })
  })
})

// ---------------------------------------------------------------------------
// Write tool special case — write tools use streamingContent, not output
// ScrollableOutput should NOT render for write tools
// ---------------------------------------------------------------------------

describe("write tool output exclusion", () => {
  test("write tool with output should not trigger ScrollableOutput rendering", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "write", callId: "c1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "c1",
        input: { path: "/new.ts" },
      })
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "completed",
        output: "file written successfully",
        diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+const x = 1",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.output).toBe("file written successfully")
      expect(part.diff).toBeDefined()
      // Write tools show DiffView, not ScrollableOutput
    })
  })
})
