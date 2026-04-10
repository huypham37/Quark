// Tests for #108: sub-agent tool spinners should stop after main agent abort
//
// When tool-end fires with status "error" on a parent bash tool that has a
// subAgent, the reducer must cascade the error to subAgent.done and mark
// all pending/running child tools as "error".

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

/** Helper: set up a parent bash tool with a sub-agent containing child tools */
function setupSubAgent(state: ReturnType<typeof createAppState>, opts?: {
  childTools?: Array<{ tool: string; callId: string; endStatus?: "completed" | "error" }>
}) {
  dispatch(state, { type: "add-assistant-message", id: "m1" })
  dispatch(state, { type: "tool-start", messageId: "m1", tool: "bash", callId: "parent-1" })
  dispatch(state, {
    type: "tool-input",
    messageId: "m1",
    callId: "parent-1",
    input: { command: 'quark --sub-agent --profile finder --prompt "explore"' },
  })

  const children = opts?.childTools ?? [
    { tool: "read", callId: "child-1" },
    { tool: "grep", callId: "child-2" },
  ]

  for (const child of children) {
    dispatch(state, {
      type: "subagent-tool-start",
      messageId: "m1",
      parentCallId: "parent-1",
      profile: "finder",
      tool: child.tool,
      callId: child.callId,
    })
    // Move to running
    dispatch(state, {
      type: "subagent-tool-input",
      messageId: "m1",
      parentCallId: "parent-1",
      profile: "finder",
      tool: child.tool,
      callId: child.callId,
      input: {},
    })
    // If this child should be pre-completed
    if (child.endStatus) {
      dispatch(state, {
        type: "subagent-tool-end",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        tool: child.tool,
        callId: child.callId,
        status: child.endStatus,
      })
    }
  }
}

describe("tool-end error cascades to sub-agent (#108)", () => {
  test("tool-end error marks subAgent.done=true and running child tools as error", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      setupSubAgent(state)

      // Verify children are running before abort
      const partBefore = state.store.messages[0]!.parts[0] as any
      expect(partBefore.subAgent.done).toBe(false)
      expect(partBefore.subAgent.tools[0].status).toBe("running")
      expect(partBefore.subAgent.tools[1].status).toBe("running")

      // Abort: parent tool-end with error
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "error",
        error: "Tool execution aborted",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.status).toBe("error")
      expect(part.subAgent.done).toBe(true)
      expect(part.subAgent.tools[0].status).toBe("error")
      expect(part.subAgent.tools[1].status).toBe("error")
    })
  })

  test("tool-end error preserves already-completed child tools", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      setupSubAgent(state, {
        childTools: [
          { tool: "read", callId: "child-1", endStatus: "completed" },
          { tool: "grep", callId: "child-2" }, // still running
          { tool: "glob", callId: "child-3" }, // still running
        ],
      })

      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "error",
        error: "Tool execution aborted",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent.done).toBe(true)
      // Completed child stays completed
      expect(part.subAgent.tools[0].status).toBe("completed")
      // Running children become error
      expect(part.subAgent.tools[1].status).toBe("error")
      expect(part.subAgent.tools[2].status).toBe("error")
    })
  })

  test("tool-end error with no subAgent does not crash", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      dispatch(state, { type: "add-assistant-message", id: "m1" })
      dispatch(state, { type: "tool-start", messageId: "m1", tool: "read", callId: "c1" })

      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "c1",
        status: "error",
        error: "Tool execution aborted",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.status).toBe("error")
      expect(part.subAgent).toBeUndefined()
    })
  })

  test("tool-end completed also marks subAgent.done=true", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      setupSubAgent(state)

      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "completed",
        output: "done",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.status).toBe("completed")
      expect(part.subAgent.done).toBe(true)
    })
  })

  test("tool-end error clears subAgent.textPreview", () => {
    withRoot(() => {
      const state = createAppState({ sessionId: "s1", modelName: "smart", skillCount: 0 })
      setupSubAgent(state)

      // Simulate streaming text preview
      dispatch(state, {
        type: "subagent-text-delta",
        messageId: "m1",
        parentCallId: "parent-1",
        profile: "finder",
        text: "working on something...",
      })

      const partBefore = state.store.messages[0]!.parts[0] as any
      expect(partBefore.subAgent.textPreview).toBeDefined()

      // Abort
      dispatch(state, {
        type: "tool-end",
        messageId: "m1",
        callId: "parent-1",
        status: "error",
        error: "Tool execution aborted",
      })

      const part = state.store.messages[0]!.parts[0] as any
      expect(part.subAgent.textPreview).toBeUndefined()
    })
  })
})
