// Tests for question-related TUI state management
//
// Verifies that question-request events are dispatched to the store,
// question-reply/reject clears the state, and the UI data flows correctly.

import { describe, test, expect, beforeEach } from "bun:test"
import {
  createAppState,
  dispatch,
  type AppState,
  type QuestionRequest,
} from "../../src/tui/state"

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
