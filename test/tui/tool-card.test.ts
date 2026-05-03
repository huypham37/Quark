// Tests for ToolCard — unified tool rendering
//
// Verifies:
// - ToolCard exists and old components (ToolResultView, ToolInvocationBlock) are removed
// - message-item.tsx uses ToolCard (collapsed Match cases)
// - Bash sub-agent rendering uses ToolCard
// - All tool parts share the same data shape compatible with ToolCard

import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { existsSync } from "fs"
import { resolve } from "path"
import { createRoot } from "solid-js"
import { createAppState, dispatch } from "../../src/tui/state"

const TOOL_CARD_SRC = readFileSync(resolve(import.meta.dir, "../../src/tui/components/tool-card.tsx"), "utf8")
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
// Component migration regression
// ---------------------------------------------------------------------------

describe("ToolCard migration (ToolResultView + ToolInvocationBlock → ToolCard)", () => {
  test("ToolCard is exported from tool-card.tsx", () => {
    expect(TOOL_CARD_SRC).toContain("export const ToolCard")
  })

  test("old ToolResultView file is deleted", () => {
    expect(existsSync(resolve(import.meta.dir, "../../src/tui/components/tool-result.tsx"))).toBe(false)
  })

  test("old ToolInvocationBlock file is deleted", () => {
    expect(existsSync(resolve(import.meta.dir, "../../src/tui/components/tool-invocation.tsx"))).toBe(false)
  })

  test("message-item.tsx imports ToolCard instead of old components", () => {
    expect(MESSAGE_ITEM_SRC).toContain('import { ToolCard }')
    expect(MESSAGE_ITEM_SRC).not.toContain('import { ToolResultView }')
    expect(MESSAGE_ITEM_SRC).not.toContain('import { ToolInvocationBlock }')
  })

  test("message-item.tsx has only 2 tool-related Match cases", () => {
    // Count <Match when={...type === "tool"}> occurrences
    const toolMatches = MESSAGE_ITEM_SRC.match(/when=\{.*type\s*===\s*"tool"/g)
    expect(toolMatches).not.toBeNull()
    // 2 cases: sub-agent (with ToolCard + SubAgentView) and catch-all (ToolCard only)
    expect(toolMatches!.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Bash sub-agent rendering conformance
// ---------------------------------------------------------------------------

describe("bash sub-agent rendering uses ToolCard", () => {
  test("completed bash sub-agent part has status compatible with ToolCard", () => {
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

  test("errored bash sub-agent part has error status compatible with ToolCard", () => {
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
// Unified render contract: all tools share ToolCard shape
// ---------------------------------------------------------------------------

describe("unified render contract for completed/error tools", () => {
  test("completed bash tool (non-sub-agent) has same shape as completed write tool", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })

      // Bash tool
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "c1" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c1", input: { command: "ls" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c1", status: "completed", output: "file1\nfile2" })

      // Write tool
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "write", callId: "c2" })
      dispatch(state, { type: "tool-input", messageId: "m1", callId: "c2", input: { filePath: "/test.ts" } })
      dispatch(state, { type: "tool-end", messageId: "m1", callId: "c2", status: "completed", output: "export const x = 1" })

      const parts = state.store.messages[0]!.parts
      expect(parts).toHaveLength(2)

      const bashPart = parts[0] as any
      const writePart = parts[1] as any

      // Both should have the same structure compatible with ToolCard
      expect(bashPart.type).toBe("tool")
      expect(bashPart.status).toBe("completed")
      expect(typeof bashPart.tool).toBe("string")
      expect(typeof bashPart.input).toBe("object")
      expect(typeof bashPart.output).toBe("string")
      expect(bashPart.subAgent).toBeUndefined()

      expect(writePart.type).toBe("tool")
      expect(writePart.status).toBe("completed")
      expect(typeof writePart.tool).toBe("string")
      expect(typeof writePart.input).toBe("object")
      expect(typeof writePart.output).toBe("string")
      expect(writePart.subAgent).toBeUndefined()
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

// ---------------------------------------------------------------------------
// ToolCard header state rendering
// ---------------------------------------------------------------------------

describe("ToolCard header states", () => {
  test("ToolCard header renders pending state with muted ellipsis", () => {
    expect(TOOL_CARD_SRC).toContain("… ")
    expect(TOOL_CARD_SRC).toContain("isPending()")
  })

  test("ToolCard header renders awaiting_approval with pause symbol", () => {
    expect(TOOL_CARD_SRC).toContain("⏸ ")
    expect(TOOL_CARD_SRC).toContain("isAwaiting()")
  })

  test("ToolCard header renders running with InlineSpinner", () => {
    expect(TOOL_CARD_SRC).toContain("InlineSpinner")
    expect(TOOL_CARD_SRC).toContain("isRunning()")
  })

  test("ToolCard header renders completed with green check", () => {
    expect(TOOL_CARD_SRC).toContain("✓ ")
  })

  test("ToolCard header renders error with red cross", () => {
    expect(TOOL_CARD_SRC).toContain("✗ ")
    expect(TOOL_CARD_SRC).toContain("isError()")
  })
})

// ---------------------------------------------------------------------------
// ToolCard body polymorphic rendering
// ---------------------------------------------------------------------------

describe("ToolCard body polymorphic rendering", () => {
  test("write tool renders WriteStreamView for running + streamingContent", () => {
    expect(TOOL_CARD_SRC).toContain("WriteStreamView")
    expect(TOOL_CARD_SRC).toContain('tool === "write"')
    expect(TOOL_CARD_SRC).toContain('status === "running"')
    expect(TOOL_CARD_SRC).toContain("streamingContent")
  })

  test("edit tool renders DiffView for completed + diff", () => {
    expect(TOOL_CARD_SRC).toContain("DiffView")
    expect(TOOL_CARD_SRC).toContain("props.diff")
    expect(TOOL_CARD_SRC).toContain('status === "completed"')
  })

  test("bash tool renders ScrollableOutput for terminal state with output", () => {
    expect(TOOL_CARD_SRC).toContain("ScrollableOutput")
    expect(TOOL_CARD_SRC).toContain("props.output")
  })

  test("todo/question/skill tools render empty body", () => {
    // The body only shows WriteStreamView, DiffView, or ScrollableOutput
    // — no special cases for todo/question/skill means empty body
    const bodyLines = TOOL_CARD_SRC.split("ToolCardBody")[1] ?? ""
    // Should NOT have todo-specific, question-specific, or skill-specific body rendering
    expect(bodyLines).not.toContain('tool === "todo"')
    expect(bodyLines).not.toContain('tool === "question"')
    expect(bodyLines).not.toContain('tool === "skill"')
  })
})
