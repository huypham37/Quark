// Tests for question-related TUI state management
//
// Verifies that question-request events are dispatched to the store,
// question-reply/reject clears the state, and the UI data flows correctly.

import { describe, test, expect, beforeEach } from "bun:test"
import { createSignal } from "solid-js"
import {
  createAppState,
  dispatch,
  type AppState,
  type QuestionRequest,
} from "../../src/tui/state"
import { createQuestionKeyHandler } from "../../src/tui/question-key-handler"

let state: AppState

beforeEach(() => {
  state = createAppState({
    sessionId: "test-session",
    modelName: "gpt-4",
    skillCount: 0,
  })
})

describe("question state", () => {
  test("set-question stores the question request", () => {
    const request: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [
            { label: "React", description: "React library" },
            { label: "Vue", description: "Vue library" },
          ],
        },
      ],
    }

    dispatch(state, { type: "set-question", request })
    expect(state.store.question).toEqual(request)
  })

  test("clear-question removes the question request", () => {
    const request: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [
        {
          question: "Pick?",
          header: "Pick",
          options: [{ label: "A", description: "a" }],
        },
      ],
    }

    dispatch(state, { type: "set-question", request })
    expect(state.store.question).toBeTruthy()

    dispatch(state, { type: "clear-question" })
    expect(state.store.question).toBeUndefined()
  })

  test("set-question queues when another question is active", () => {
    const q1: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [{ question: "Q1?", header: "Q1", options: [] }],
    }
    const q2: QuestionRequest = {
      requestId: "q-2",
      sessionId: "test-session",
      questions: [{ question: "Q2?", header: "Q2", options: [] }],
    }

    dispatch(state, { type: "set-question", request: q1 })
    dispatch(state, { type: "set-question", request: q2 })

    // First question is active
    expect(state.store.question?.requestId).toBe("q-1")
    expect(state.store.questionQueue).toHaveLength(1)
    expect(state.store.questionQueue[0]?.requestId).toBe("q-2")
  })

  test("clear-question promotes next from queue", () => {
    const q1: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [{ question: "Q1?", header: "Q1", options: [] }],
    }
    const q2: QuestionRequest = {
      requestId: "q-2",
      sessionId: "test-session",
      questions: [{ question: "Q2?", header: "Q2", options: [] }],
    }

    dispatch(state, { type: "set-question", request: q1 })
    dispatch(state, { type: "set-question", request: q2 })
    dispatch(state, { type: "clear-question" })

    expect(state.store.question?.requestId).toBe("q-2")
    expect(state.store.questionQueue).toHaveLength(0)
  })

  test("reset-session clears question state", () => {
    const request: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [{ question: "Q?", header: "Q", options: [] }],
    }

    dispatch(state, { type: "set-question", request })
    dispatch(state, { type: "reset-session", sessionId: null })

    expect(state.store.question).toBeUndefined()
  })

  test("question disables running state like permission does", () => {
    dispatch(state, { type: "set-running", running: true })
    expect(state.store.running).toBe(true)

    const request: QuestionRequest = {
      requestId: "q-1",
      sessionId: "test-session",
      questions: [{ question: "Q?", header: "Q", options: [] }],
    }

    dispatch(state, { type: "set-question", request })
    expect(state.store.running).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Issue #164 — createQuestionKeyHandler custom input mode
// ---------------------------------------------------------------------------

/** Build a minimal QuestionRequest for key-handler tests. */
function makeRequest(overrides?: Partial<QuestionRequest["questions"][0]>): QuestionRequest {
  return {
    requestId: "q-test",
    sessionId: "test-session",
    questions: [
      {
        question: "Pick one?",
        header: "Pick",
        options: [
          { label: "Option A", description: "First option" },
          { label: "Option B", description: "Second option" },
        ],
        ...overrides,
      },
    ],
  }
}

describe("issue #164: createQuestionKeyHandler custom mode", () => {
  // -----------------------------------------------------------------------
  // custom: true — handler exposes custom mode and virtual custom option
  // -----------------------------------------------------------------------

  test("custom: true — handler exposes customMode and customText signals", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {},
      onReject: () => {},
    })

    // The handler must expose signals for custom input mode
    expect(handler).toHaveProperty("customMode")
    expect(handler).toHaveProperty("customText")

    // Initially not in custom mode, text is empty
    expect(handler.customMode()).toBe(false)
    expect(handler.customText()).toBe("")
  })

  test("custom: true — navigating to the virtual custom option and activating it enters custom mode", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {},
      onReject: () => {},
    })

    // Navigate down past the two regular options (indices 0 and 1)
    // to reach the virtual custom option (index 2)
    handler.handleKey("down") // selected: 0 → 1
    handler.handleKey("down") // selected: 1 → 2 (virtual custom option)

    // Activate the virtual custom option with enter
    const consumed = handler.handleKey("return")
    expect(consumed).toBe(true)

    // Should now be in custom input mode
    expect(handler.customMode()).toBe(true)
  })

  test("custom: true — in custom mode, character keys are consumed and build customText", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {},
      onReject: () => {},
    })

    // Enter custom mode
    handler.handleKey("down")
    handler.handleKey("down")
    handler.handleKey("return")
    expect(handler.customMode()).toBe(true)

    // Type characters — each should be consumed and appended
    expect(handler.handleKey("h")).toBe(true)
    expect(handler.customText()).toBe("h")

    expect(handler.handleKey("e")).toBe(true)
    expect(handler.customText()).toBe("he")

    expect(handler.handleKey("l")).toBe(true)
    expect(handler.handleKey("l")).toBe(true)
    expect(handler.handleKey("o")).toBe(true)
    expect(handler.customText()).toBe("hello")
  })

  test("custom: true — backspace in custom mode removes last character", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {},
      onReject: () => {},
    })

    // Enter custom mode
    handler.handleKey("down")
    handler.handleKey("down")
    handler.handleKey("return")

    // Type, then backspace
    handler.handleKey("a")
    handler.handleKey("b")
    expect(handler.customText()).toBe("ab")

    handler.handleKey("backspace")
    expect(handler.customText()).toBe("a")

    handler.handleKey("backspace")
    expect(handler.customText()).toBe("")
  })

  test("custom: true — submitting non-empty custom string calls onReply with answers string[][] shape", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    let repliedAnswers: string[][] | null = null
    const handler = createQuestionKeyHandler({
      request,
      onReply: (answers) => {
        repliedAnswers = answers
      },
      onReject: () => {},
    })

    // Enter custom mode
    handler.handleKey("down")
    handler.handleKey("down")
    handler.handleKey("return")

    // Type a custom answer
    handler.handleKey("m")
    handler.handleKey("y")
    handler.handleKey(" ")
    handler.handleKey("t")
    handler.handleKey("e")
    handler.handleKey("x")
    handler.handleKey("t")

    // Submit
    handler.handleKey("return")

    // Should have called onReply with the custom text in answers shape
    expect(repliedAnswers).not.toBeNull()
    expect(repliedAnswers).toEqual([["my text"]])
  })

  test("custom: true — submitting empty custom string does not fire onReply", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    let replyCalled = false
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {
        replyCalled = true
      },
      onReject: () => {},
    })

    // Enter custom mode
    handler.handleKey("down")
    handler.handleKey("down")
    handler.handleKey("return")

    // Submit without typing anything
    handler.handleKey("return")

    // Should not have replied — empty custom input is invalid
    expect(replyCalled).toBe(false)
    // Should still be in custom mode
    expect(handler.customMode()).toBe(true)
  })

  test("custom: true — escape in custom mode dismisses the question", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: true }),
    )
    let rejected = false
    const handler = createQuestionKeyHandler({
      request,
      onReply: () => {},
      onReject: () => {
        rejected = true
      },
    })

    // Enter custom mode
    handler.handleKey("down")
    handler.handleKey("down")
    handler.handleKey("return")
    expect(handler.customMode()).toBe(true)

    handler.handleKey("escape")
    expect(rejected).toBe(true)
    expect(handler.customMode()).toBe(false)
    expect(handler.customText()).toBe("")
  })

  // -----------------------------------------------------------------------
  // custom omitted or false — retains existing behavior
  // -----------------------------------------------------------------------

  test("custom omitted — no custom mode signals exposed, or they remain inactive", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest(), // no custom field
    )
    let replied: string[][] | null = null
    const handler = createQuestionKeyHandler({
      request,
      onReply: (a) => {
        replied = a
      },
      onReject: () => {},
    })

    // Navigating past all options should wrap around, not enter custom mode
    handler.handleKey("down") // 0 → 1
    handler.handleKey("down") // 1 → 0 (wraps)

    // If customMode exists, it should be false
    if (handler.customMode) {
      expect(handler.customMode()).toBe(false)
    }

    // Pressing enter selects the current option normally
    handler.handleKey("return")
    // In single-select mode, onReply fires immediately
    expect(replied).toEqual([["Option A"]])
  })

  test("custom: false — explicitly false behaves same as omitted", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: false }),
    )
    let replied: string[][] | null = null
    const handler = createQuestionKeyHandler({
      request,
      onReply: (a) => {
        replied = a
      },
      onReject: () => {},
    })

    // Navigating past all options should wrap
    handler.handleKey("down") // 0 → 1
    handler.handleKey("down") // 1 → 0 (wraps)

    // If customMode exists, it must be false
    if (handler.customMode) {
      expect(handler.customMode()).toBe(false)
    }

    // Normal selection behavior works
    handler.handleKey("return")
    expect(replied).toEqual([["Option A"]])
  })

  test("custom: false — number keys still select regular options", () => {
    const [request] = createSignal<QuestionRequest | undefined>(
      makeRequest({ custom: false }),
    )
    let replied: string[][] | null = null
    const handler = createQuestionKeyHandler({
      request,
      onReply: (a) => {
        replied = a
      },
      onReject: () => {},
    })

    // Press "2" to directly select Option B
    handler.handleKey("2")
    expect(replied).toEqual([["Option B"]])
  })
})
