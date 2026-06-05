// Tests for thinking-block collapse feature (showThinking flag)
//
// Feature: Thinking blocks should be collapsed by default (only header row
// visible). There should be a global toggle (Ctrl+Shift+T) that shows/hides
// all thinking text across all messages.
//
// These tests WILL FAIL until the implementation is added:
//   1. AppStore needs a `showThinking: boolean` field defaulting to false
//   2. TuiAction needs a `toggle-show-thinking` action type
//   3. dispatch must handle `toggle-show-thinking` by flipping the flag
//   4. reset-session must NOT reset showThinking (persists across sessions)

import { describe, test, expect } from "bun:test"
import { createRoot } from "solid-js"
import { createAppState, dispatch } from "../../src/tui/state"

// Helper: run a test inside a SolidJS reactive root
function withRoot<T>(fn: () => T): T {
  let result!: T
  createRoot((dispose) => {
    result = fn()
    dispose()
  })
  return result
}

describe("showThinking (thinking collapse feature)", () => {
  test("showThinking defaults to false in initial state", () => {
    withRoot(() => {
      const state = createAppState({
        sessionId: null,
        modelName: "smart",
        skillCount: 0,
      })

      // FAILS: store.showThinking is undefined (not yet added to AppStore initial state)
      expect((state.store as any).showThinking).toBe(false)
    })
  })

  test("toggle-show-thinking toggles the value false → true → false", () => {
    withRoot(() => {
      const state = createAppState({
        sessionId: null,
        modelName: "smart",
        skillCount: 0,
      })

      // FAILS: store.showThinking is undefined, not false
      expect((state.store as any).showThinking).toBe(false)

      // Toggle on — FAILS: dispatch doesn't handle toggle-show-thinking yet
      dispatch(state, { type: "toggle-show-thinking" } as any)
      expect((state.store as any).showThinking).toBe(true)

      // Toggle off
      dispatch(state, { type: "toggle-show-thinking" } as any)
      expect((state.store as any).showThinking).toBe(false)

      // Round-trip: toggle on again to verify idempotent behavior
      dispatch(state, { type: "toggle-show-thinking" } as any)
      expect((state.store as any).showThinking).toBe(true)
    })
  })

  test("reset-session does NOT reset showThinking (persists across sessions)", () => {
    withRoot(() => {
      const state = createAppState({
        sessionId: "s1",
        modelName: "smart",
        skillCount: 0,
      })

      // Simulate user toggling thinking on (dispatch doesn't handle it yet)
      dispatch(state, { type: "toggle-show-thinking" } as any)
      // FAILS: showThinking is undefined because toggle-show-thinking isn't handled
      expect((state.store as any).showThinking).toBe(true)

      // Reset session — should preserve showThinking
      dispatch(state, { type: "reset-session", sessionId: "s2" })

      // FAILS: showThinking is still undefined (not preserved because it was
      // never properly initialized in the store)
      expect((state.store as any).showThinking).toBe(true)

      // Verify other state was properly reset
      expect(state.store.sessionId).toBe("s2")
      expect(state.store.messages).toEqual([])
      expect(state.store.running).toBe(false)
    })
  })

  test("showThinking survives after load-session", () => {
    withRoot(() => {
      const state = createAppState({
        sessionId: null,
        modelName: "smart",
        skillCount: 0,
      })

      // Toggle on
      dispatch(state, { type: "toggle-show-thinking" } as any)
      expect((state.store as any).showThinking).toBe(true)

      // Load a session — should NOT reset showThinking
      dispatch(state, {
        type: "load-session",
        sessionId: "s-loaded",
        messages: [
          {
            id: "m1",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "hello" }],
          },
        ],
      })

      // FAILS: showThinking was lost during load-session
      expect((state.store as any).showThinking).toBe(true)
    })
  })

  test("multiple toggles maintain correct boolean state", () => {
    withRoot(() => {
      const state = createAppState({
        sessionId: null,
        modelName: "smart",
        skillCount: 0,
      })

      // Toggle 5 times: false → true → false → true → false → true
      const expected = [true, false, true, false, true]
      for (let i = 0; i < 5; i++) {
        dispatch(state, { type: "toggle-show-thinking" } as any)
        expect((state.store as any).showThinking).toBe(expected[i])
      }
    })
  })
})
