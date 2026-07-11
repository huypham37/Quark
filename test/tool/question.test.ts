// Tests for the question tool — agent asks user questions, blocks until answered
//
// The question tool uses a Promise-based blocking pattern similar to permissions:
// execute() emits a bus event and awaits a deferred promise that the TUI resolves.

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { bus } from "../../src/session/events"
import type { ToolContext } from "../../src/tool/tool"

const { questionTool, respondQuestion } = await import("../../src/tool/question")

// Shared test context
function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: "test-session",
    messageId: "test-msg",
    callId: "call-1",
    abort: new AbortController().signal,
    messages: [],
    async ask() {},
    ...overrides,
  }
}

describe("questionTool", () => {
  test("has correct id and description", () => {
    expect(questionTool.id).toBe("question")
    expect(questionTool.description).toBeTruthy()
  })

  test("emits question-request event and blocks until replied", async () => {
    const ctx = makeCtx()
    let emittedRequest: any = null

    bus.on("question-request", (data) => {
      emittedRequest = data
    })

    // Reply after a short delay
    const replyPromise = new Promise<void>((resolve) => {
      bus.on("question-request", (data) => {
        setTimeout(() => {
          respondQuestion({
            requestId: data.requestId,
            answers: [["Option A"]],
          })
          resolve()
        }, 10)
      })
    })

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "Option A", description: "First choice" },
              { label: "Option B", description: "Second choice" },
            ],
          },
        ],
      },
      ctx,
    )

    await replyPromise

    // Verify event was emitted
    expect(emittedRequest).not.toBeNull()
    expect(emittedRequest.sessionId).toBe("test-session")
    expect(emittedRequest.questions).toHaveLength(1)
    expect(emittedRequest.questions[0].question).toBe("Which framework?")

    // Verify result
    expect(result.title).toContain("1 question")
    expect(result.output).toContain("Option A")
    expect(result.metadata.answers).toEqual([["Option A"]])
  })

  test("handles multiple questions", async () => {
    const ctx = makeCtx()

    bus.on("question-request", (data) => {
      setTimeout(() => {
        respondQuestion({
          requestId: data.requestId,
          answers: [["React"], ["TypeScript"]],
        })
      }, 10)
    })

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "React", description: "React lib" },
              { label: "Vue", description: "Vue lib" },
            ],
          },
          {
            question: "Which language?",
            header: "Language",
            options: [
              { label: "TypeScript", description: "TS" },
              { label: "JavaScript", description: "JS" },
            ],
          },
        ],
      },
      ctx,
    )

    expect(result.title).toContain("2 questions")
    expect(result.output).toContain("React")
    expect(result.output).toContain("TypeScript")
    expect(result.metadata.answers).toEqual([["React"], ["TypeScript"]])
  })

  test("handles rejection (user dismisses question)", async () => {
    const ctx = makeCtx()

    bus.on("question-request", (data) => {
      setTimeout(() => {
        respondQuestion({
          requestId: data.requestId,
          rejected: true,
        })
      }, 10)
    })

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Pick one?",
            header: "Pick",
            options: [{ label: "A", description: "a" }],
          },
        ],
      },
      ctx,
    )

    expect(result.output).toContain("dismissed")
  })

  test("handles unanswered questions gracefully", async () => {
    const ctx = makeCtx()

    bus.on("question-request", (data) => {
      setTimeout(() => {
        respondQuestion({
          requestId: data.requestId,
          answers: [[]],
        })
      }, 10)
    })

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Optional pick?",
            header: "Optional",
            options: [{ label: "X", description: "x" }],
          },
        ],
      },
      ctx,
    )

    expect(result.output).toContain("Unanswered")
  })

  test("supports multiple selection answers", async () => {
    const ctx = makeCtx()

    bus.on("question-request", (data) => {
      setTimeout(() => {
        respondQuestion({
          requestId: data.requestId,
          answers: [["React", "Vue"]],
        })
      }, 10)
    })

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Which frameworks?",
            header: "Frameworks",
            options: [
              { label: "React", description: "React" },
              { label: "Vue", description: "Vue" },
              { label: "Svelte", description: "Svelte" },
            ],
            multiple: true,
          },
        ],
      },
      ctx,
    )

    expect(result.output).toContain("React, Vue")
    expect(result.metadata.answers).toEqual([["React", "Vue"]])
  })

  test("aborts when signal is aborted", async () => {
    const controller = new AbortController()
    const ctx = makeCtx({ abort: controller.signal })

    // Abort after short delay — don't reply
    setTimeout(() => controller.abort(), 20)

    const result = await questionTool.execute(
      {
        questions: [
          {
            question: "Pick?",
            header: "Pick",
            options: [{ label: "A", description: "a" }],
          },
        ],
      },
      ctx,
    )

    expect(result.output).toContain("aborted")
  })
})

// ---------------------------------------------------------------------------
// Issue #163 — custom parameter support in question tool
// ---------------------------------------------------------------------------

describe("issue #163: custom parameter in questionTool", () => {
  test("parameters schema accepts custom: true without stripping it", () => {
    const parsed = questionTool.parameters.parse({
      questions: [
        {
          question: "Pick one?",
          header: "Pick",
          options: [
            { label: "A", description: "Option A" },
            { label: "B", description: "Option B" },
          ],
          custom: true,
        },
      ],
    })

    // custom: true must be preserved in the parsed output
    expect(parsed.questions[0]).toHaveProperty("custom", true)
  })

  test("parameters schema preserves custom: false when explicitly set", () => {
    const parsed = questionTool.parameters.parse({
      questions: [
        {
          question: "Pick one?",
          header: "Pick",
          options: [{ label: "A", description: "Option A" }],
          custom: false,
        },
      ],
    })

    expect(parsed.questions[0]).toHaveProperty("custom", false)
  })

  test("parameters schema defaults custom to undefined when omitted", () => {
    const parsed = questionTool.parameters.parse({
      questions: [
        {
          question: "Pick one?",
          header: "Pick",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
    })

    // When custom is not provided, it should be undefined (not stripped)
    expect(parsed.questions[0].custom).toBeUndefined()
  })

  test("execution with custom: true emits question-request with custom preserved", async () => {
    const ctx = makeCtx()
    let emittedRequest: any = null

    bus.on("question-request", (data) => {
      emittedRequest = data
    })

    // Reply after a short delay
    const replyPromise = new Promise<void>((resolve) => {
      bus.on("question-request", (data) => {
        setTimeout(() => {
          respondQuestion({
            requestId: data.requestId,
            answers: [["Option A"]],
          })
          resolve()
        }, 10)
      })
    })

    await questionTool.execute(
      {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "Option A", description: "First choice" },
            ],
            custom: true,
          },
        ],
      },
      ctx,
    )

    await replyPromise

    expect(emittedRequest).not.toBeNull()
    expect(emittedRequest.questions[0].custom).toBe(true)
  })

  test("execution with custom: false does not set custom on emitted event", async () => {
    const ctx = makeCtx()
    let emittedRequest: any = null

    bus.on("question-request", (data) => {
      emittedRequest = data
    })

    const replyPromise = new Promise<void>((resolve) => {
      bus.on("question-request", (data) => {
        setTimeout(() => {
          respondQuestion({
            requestId: data.requestId,
            answers: [["Option A"]],
          })
          resolve()
        }, 10)
      })
    })

    await questionTool.execute(
      {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [{ label: "Option A", description: "First choice" }],
            custom: false,
          },
        ],
      },
      ctx,
    )

    await replyPromise

    expect(emittedRequest).not.toBeNull()
    // custom: false is the same as not set — it should not be true
    expect(emittedRequest.questions[0].custom).not.toBe(true)
  })
})

// Clean up bus listeners between tests
afterEach(() => {
  bus.removeAllListeners("question-request")
})
