// Regression tests for ToolResultLine -> ToolResultView rename + bash conformance
//
// Verifies:
// - ToolResultView exists and ToolResultLine does not
// - Bash sub-agent rendering uses ToolResultView (unified renderer)
// - All tool results (bash, read, write, etc.) share the same render contract

import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { createRoot } from "solid-js"
import { createAppState, dispatch } from "../../src/tui/state"

const TOOL_RESULT_SRC = readFileSync(resolve(import.meta.dir, "../../src/tui/components/tool-result.tsx"), "utf8")
const MESSAGE_ITEM_SRC = readFileSync(resolve(import.meta.dir, "../../src/tui/components/message-item.tsx"), "utf8")

function withRoot<T>(fn: () => T): T {
  let result!: T
  createRoot((dispose) => {
    result = fn()
    dispose()
  })
  return result
}

// ---------------------------------------------------------------------------
// Component rename regression
// ---------------------------------------------------------------------------

describe("ToolResultView rename (ToolResultLine -> ToolResultView)", () => {
  test("ToolResultView is exported from tool-result.tsx", () => {
    expect(TOOL_RESULT_SRC).toContain("export const ToolResultView")
  })

  test("legacy ToolResultLine is no longer exported", () => {
    // Should not have "export const ToolResultLine" anymore
    expect(TOOL_RESULT_SRC).not.toMatch(/export const ToolResultLine/)
  })

  test("message-item.tsx imports ToolResultView instead of ToolResultLine", () => {
    expect(MESSAGE_ITEM_SRC).toContain('import { ToolResultView }')
    expect(MESSAGE_ITEM_SRC).not.toContain('import { ToolResultLine }')
  })
})

// ---------------------------------------------------------------------------
// Bash sub-agent rendering conformance
// ---------------------------------------------------------------------------

describe("bash sub-agent rendering uses ToolResultView", () => {
  test("completed bash sub-agent part has status compatible with ToolResultView", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "parent-1",
        input: { command: 'quark --sub-agent --profile finder --prompt "explore"' },
      })

      // Complete the parent bash tool
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "completed",
        output: "done",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.type).toBe("tool")
      expect(part.tool).toBe("bash")
      expect(part.status).toBe("completed")
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.done).toBe(true)
    })
  })

  test("errored bash sub-agent part has error status compatible with ToolResultView", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
      dispatch(state, {
        type: "tool-input",
        messageId: "m1",
        callId: "parent-1",
        input: { command: 'quark --sub-agent --profile finder --prompt "explore"' },
      })

      // Error the parent bash tool
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "error",
        error: "aborted",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.type).toBe("tool")
      expect(part.tool).toBe("bash")
      expect(part.status).toBe("error")
      expect(part.subAgent).toBeDefined()
      expect(part.subAgent.done).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Unified render contract: all tools share ToolResultView
// ---------------------------------------------------------------------------

describe("unified render contract for completed/error tools", () => {
  test("completed bash tool (non-sub-agent) has same shape as completed read tool", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })

      // Bash tool
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c1", input: { command: "ls" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c1", status: "completed", output: "file1\nfile2" })

      // Read tool
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "read", callId: "c2" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c2", input: { filePath: "/test.ts" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c2", status: "completed", output: "export const x = 1" })

      const parts = state.store.messages[0]!.parts
      expect(parts).toHaveLength(2)

      const bashPart = parts[0] as any
      const readPart = parts[1] as any

      // Both should have the same structure compatible with ToolResultView
      expect(bashPart.type).toBe("tool")
      expect(bashPart.status).toBe("completed")
      expect(typeof bashPart.tool).toBe("string")
      expect(typeof bashPart.input).toBe("object")
      expect(typeof bashPart.output).toBe("string")
      expect(bashPart.subAgent).toBeUndefined()

      expect(readPart.type).toBe("tool")
      expect(readPart.status).toBe("completed")
      expect(typeof readPart.tool).toBe("string")
      expect(typeof readPart.input).toBe("object")
      expect(typeof readPart.output).toBe("string")
      expect(readPart.subAgent).toBeUndefined()
    })
  })

  test("error tools have consistent error field regardless of tool type", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })

      // Error bash
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c1", input: { command: "false" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c1", status: "error", error: "exit code 1" })

      // Error write
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "write", callId: "c2" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c2", input: { filePath: "/out.ts" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c2", status: "error", error: "permission denied" })

      const parts = state.store.messages[0]!.parts
      expect(parts).toHaveLength(2)

      for (const part of parts) {
        const p = part as any
        expect(p.type).toBe("tool")
        expect(p.status).toBe("error")
        expect(typeof p.error).toBe("string")
      }
    })
  })
})
