// Tests for ChatGPT Consumer API SSE parsing and event mapping.
// Validates that ChatGPT SSE events are correctly parsed and mapped to
// AI SDK LanguageModelV3StreamPart objects.
//
// TARGET SOURCE: src/provider/codex-consumer.ts (parseCodexSSE export)
// STATUS: Source file DOES NOT EXIST yet — these tests will FAIL at import time.
//
// Pattern: Isolated unit tests for the SSE parsing function.
// No HTTP mocking needed — we test the parser directly with raw SSE strings.

import { describe, test, expect } from "bun:test"
import {
  createCodexConsumer,
  parseCodexSSE,
} from "../../src/provider/codex-consumer"
import type { FetchFn } from "../../src/provider/codex-auth"
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a mock Response that returns a ReadableStream of SSE data. */
function sseResponse(events: string[]): Response {
  const lines = events.map((e) => `data: ${e}\n\n`).join("")
  const encoder = new TextEncoder()
  let index = 0
  let timeoutId: Timer | null = null
  const stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      function pushChunk() {
        if (index < lines.length) {
          controller.enqueue(encoder.encode(lines[index] ?? ""))
          index++
          timeoutId = setTimeout(pushChunk, 0)
        } else {
          controller.close()
        }
      }
      pushChunk()
    },
    cancel() {
      if (timeoutId) clearTimeout(timeoutId)
    },
  })
  return new Response(stream, { status: 200 })
}

/** Collect all stream parts from a doStream call. */
async function collectFromModel(
  model: LanguageModelV3,
): Promise<LanguageModelV3StreamPart[]> {
  const result = await model.doStream({
    prompt: [
      { role: "system", content: [{ type: "text", text: "You are helpful." }] },
      { role: "user", content: [{ type: "text", text: "Test" }] },
    ],
  })
  const reader = result.stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.output_text.delta
// ---------------------------------------------------------------------------
describe("SSE → text-delta", () => {
  test("response.output_text.delta emits text-delta stream part", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "Hello" }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const textDeltas = parts.filter((p) => p.type === "text-delta")

    expect(textDeltas.length).toBeGreaterThan(0)
    if (textDeltas[0]?.type === "text-delta") {
      expect(textDeltas[0].delta).toBe("Hello")
    }
  })

  test("multiple text deltas are emitted in order", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "Hel" }),
        JSON.stringify({ type: "response.output_text.delta", delta: "lo " }),
        JSON.stringify({ type: "response.output_text.delta", delta: "World" }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 3 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    const combined = textDeltas
      .map((p) => (p.type === "text-delta" ? p.delta : ""))
      .join("")
    expect(combined).toBe("Hello World")
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.reasoning_text.delta
// ---------------------------------------------------------------------------
describe("SSE → reasoning-delta", () => {
  test("response.reasoning_text.delta emits reasoning-delta stream part", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({
          type: "response.reasoning_text.delta",
          delta: "Let me think...",
        }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const reasoningDeltas = parts.filter((p) => p.type === "reasoning-delta")

    expect(reasoningDeltas.length).toBeGreaterThan(0)
    if (reasoningDeltas[0]?.type === "reasoning-delta") {
      expect(reasoningDeltas[0].delta).toBe("Let me think...")
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.function_call_arguments.delta
// ---------------------------------------------------------------------------
describe("SSE → tool-input-delta", () => {
  test("function_call_arguments.delta emits tool-input-delta stream part", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({
          type: "response.function_call_arguments.delta",
          delta: '{"path":',
        }),
        JSON.stringify({
          type: "response.function_call_arguments.delta",
          delta: '"/src/index.ts"}',
        }),
        JSON.stringify({
          type: "response.output_item.done",
          item: {
            id: "call_abc123",
            type: "function_call",
            name: "read_file",
            arguments: '{"path":"/src/index.ts"}',
          },
        }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const toolDeltas = parts.filter((p) => p.type === "tool-input-delta")

    expect(toolDeltas.length).toBeGreaterThan(0)
    if (toolDeltas[0]?.type === "tool-input-delta") {
      expect(toolDeltas[0].delta).toBe('{"path":')
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.output_item.done (function_call)
// ---------------------------------------------------------------------------
describe("SSE → tool-call", () => {
  test("output_item.done for function_call emits tool-call stream part", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({
          type: "response.function_call_arguments.delta",
          delta: '{"path":"/tmp/test"}',
        }),
        JSON.stringify({
          type: "response.output_item.done",
          item: {
            id: "call_xyz789",
            type: "function_call",
            name: "bash",
            arguments: '{"path":"/tmp/test"}',
          },
        }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 5, output_tokens: 10 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const toolCalls = parts.filter((p) => p.type === "tool-call")

    expect(toolCalls.length).toBeGreaterThan(0)
    if (toolCalls[0]?.type === "tool-call") {
      expect(toolCalls[0].toolCallId).toBe("call_xyz789")
      expect(toolCalls[0].toolName).toBe("bash")
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.completed
// ---------------------------------------------------------------------------
describe("SSE → finish (response.completed)", () => {
  test("response.completed emits finish with usage", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "done" }),
        JSON.stringify({
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 15,
              output_tokens: 25,
              input_tokens_details: { cached_tokens: 5 },
              output_tokens_details: { reasoning_tokens: 10 },
            },
          },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const finishParts = parts.filter((p) => p.type === "finish")

    expect(finishParts.length).toBe(1)
    if (finishParts[0]?.type === "finish") {
      expect(finishParts[0].finishReason.unified).toBe("stop")
      expect(finishParts[0].usage.inputTokens.total).toBe(15)
      expect(finishParts[0].usage.outputTokens.total).toBe(25)
    }
  })

  test("response.completed maps raw finish reason", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "ok" }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const finishParts = parts.filter((p) => p.type === "finish")

    if (finishParts[0]?.type === "finish") {
      expect(finishParts[0].finishReason.raw).toBe("completed")
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.done
// ---------------------------------------------------------------------------
describe("SSE → finish (response.done)", () => {
  test("response.done emits finish", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "ok" }),
        JSON.stringify({
          type: "response.done",
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const finishParts = parts.filter((p) => p.type === "finish")

    expect(finishParts.length).toBeGreaterThan(0)
  })

  test("response.done emits raw finish reason 'done'", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "ok" }),
        JSON.stringify({ type: "response.done" }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const finishParts = parts.filter((p) => p.type === "finish")

    if (finishParts[0]?.type === "finish") {
      expect(finishParts[0].finishReason.raw).toBe("done")
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.incomplete
// ---------------------------------------------------------------------------
describe("SSE → finish (response.incomplete)", () => {
  test("response.incomplete emits finish with length reason", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "cut of" }),
        JSON.stringify({ type: "response.incomplete" }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const finishParts = parts.filter((p) => p.type === "finish")

    expect(finishParts.length).toBe(1)
    if (finishParts[0]?.type === "finish") {
      expect(finishParts[0].finishReason.unified).toBe("length")
    }
  })
})

// ---------------------------------------------------------------------------
// SSE Event Mapping — response.failed / error
// ---------------------------------------------------------------------------
describe("SSE → error (response.failed)", () => {
  test("response.failed produces error in stream", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "partial" }),
        JSON.stringify({
          type: "response.failed",
          error: { message: "content_filter triggered" },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)

    // Should have error-type part OR finish with error reason
    const errorPart = parts.find(
      (p) => p.type === "error" || (p.type === "finish" && p.finishReason.unified === "error"),
    )
    expect(errorPart).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Edge cases — malformed SSE, empty streams, etc.
// ---------------------------------------------------------------------------
describe("SSE parsing — edge cases", () => {
  test("empty stream closes cleanly", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(new ReadableStream({
        start(controller) {
          controller.close()
        },
      }), { status: 200 })

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    // Should not throw
    const parts = await collectFromModel(model)
    expect(Array.isArray(parts)).toBe(true)
  })

  test("malformed SSE line (non-JSON) is handled gracefully", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        "this is not json",
        JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    // Should not throw — either skips malformed line or emits error
    const parts = await collectFromModel(model)
    expect(Array.isArray(parts)).toBe(true)
  })

  test("SSE with comment-only lines (starting with :) is ignored", async () => {
    const mockFetch: FetchFn = async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        type: "bytes",
        start(controller) {
          controller.enqueue(encoder.encode(": keepalive\n\n"))
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "after-comment" })}\n\n`,
          ))
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
          ))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas.length).toBeGreaterThan(0)
    if (textDeltas[0]?.type === "text-delta") {
      expect(textDeltas[0].delta).toBe("after-comment")
    }
  })

  test("SSE with multiple events per data line", async () => {
    const mockFetch: FetchFn = async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        type: "bytes",
        start(controller) {
          // Single flush with multiple data lines separated by \n\n
          const multiEvent = [
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "first" })}`,
            "",
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "second" })}`,
            "",
            `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 2 } } })}`,
            "",
            "",
          ].join("\n")
          controller.enqueue(encoder.encode(multiEvent))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas.length).toBe(2)
  })

  test("unknown event type is silently ignored", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.unknown_event", data: "ignored" }),
        JSON.stringify({ type: "response.output_text.delta", delta: "valid" }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas.length).toBe(1)
    if (textDeltas[0]?.type === "text-delta") {
      expect(textDeltas[0].delta).toBe("valid")
    }
  })

  test("stream parts have required id field", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "hello" }),
        JSON.stringify({ type: "response.reasoning_text.delta", delta: "think" }),
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)

    for (const part of parts) {
      if (part.type === "text-delta") {
        expect(typeof part.id).toBe("string")
        expect(part.id.length).toBeGreaterThan(0)
      }
      if (part.type === "reasoning-delta") {
        expect(typeof part.id).toBe("string")
        expect(part.id.length).toBeGreaterThan(0)
      }
      if (part.type === "tool-input-delta") {
        expect(typeof part.id).toBe("string")
        expect(part.id.length).toBeGreaterThan(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// SSE full sequence — integration-style flow
// ---------------------------------------------------------------------------
describe("SSE — full sequence", () => {
  test("reasoning → text → tool call → finish sequence", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        // Start with reasoning
        JSON.stringify({ type: "response.reasoning_text.delta", delta: "I need to read the file" }),
        // Then text
        JSON.stringify({ type: "response.output_text.delta", delta: "Let me read that for you." }),
        // Then tool call
        JSON.stringify({ type: "response.function_call_arguments.delta", delta: '{"filePath":"/tmp/test.txt"}' }),
        JSON.stringify({
          type: "response.output_item.done",
          item: {
            id: "call_read_1",
            type: "function_call",
            name: "read",
            arguments: '{"filePath":"/tmp/test.txt"}',
          },
        }),
        // Finish
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 50, output_tokens: 30 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)

    const reasoning = parts.filter((p) => p.type === "reasoning-delta")
    const text = parts.filter((p) => p.type === "text-delta")
    const toolDelta = parts.filter((p) => p.type === "tool-input-delta")
    const toolCall = parts.filter((p) => p.type === "tool-call")
    const finish = parts.filter((p) => p.type === "finish")

    expect(reasoning.length).toBeGreaterThan(0)
    expect(text.length).toBeGreaterThan(0)
    expect(toolDelta.length).toBeGreaterThan(0)
    expect(toolCall.length).toBe(1)
    expect(finish.length).toBe(1)
  })

  test("multiple tool calls in sequence", async () => {
    const mockFetch: FetchFn = async () =>
      sseResponse([
        // First tool call
        JSON.stringify({ type: "response.function_call_arguments.delta", delta: '{"path":"/a"}' }),
        JSON.stringify({
          type: "response.output_item.done",
          item: { id: "call_1", type: "function_call", name: "read", arguments: '{"path":"/a"}' },
        }),
        // Second tool call
        JSON.stringify({ type: "response.function_call_arguments.delta", delta: '{"path":"/b"}' }),
        JSON.stringify({
          type: "response.output_item.done",
          item: { id: "call_2", type: "function_call", name: "read", arguments: '{"path":"/b"}' },
        }),
        // Finish
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 10, output_tokens: 20 } },
        }),
      ])

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const parts = await collectFromModel(model)
    const toolCalls = parts.filter((p) => p.type === "tool-call")
    expect(toolCalls.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// parseCodexSSE — standalone parser unit tests
// ---------------------------------------------------------------------------
describe("parseCodexSSE (standalone)", () => {
  test("parses response.output_text.delta", () => {
    const event = JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("text-delta")
    if (part?.type === "text-delta") {
      expect(part.delta).toBe("Hello")
    }
  })

  test("parses response.reasoning_text.delta", () => {
    const event = JSON.stringify({ type: "response.reasoning_text.delta", delta: "thinking..." })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("reasoning-delta")
    if (part?.type === "reasoning-delta") {
      expect(part.delta).toBe("thinking...")
    }
  })

  test("parses response.function_call_arguments.delta", () => {
    const event = JSON.stringify({ type: "response.function_call_arguments.delta", delta: '{"a":1}' })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("tool-input-delta")
    if (part?.type === "tool-input-delta") {
      expect(part.delta).toBe('{"a":1}')
    }
  })

  test("parses response.output_item.done for function_call", () => {
    const event = JSON.stringify({
      type: "response.output_item.done",
      item: {
        id: "call_123",
        type: "function_call",
        name: "read_file",
        arguments: '{"path":"/x"}',
      },
    })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("tool-call")
  })

  test("parses response.completed", () => {
    const event = JSON.stringify({
      type: "response.completed",
      response: { usage: { input_tokens: 10, output_tokens: 20 } },
    })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("finish")
  })

  test("parses response.done", () => {
    const event = JSON.stringify({ type: "response.done" })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("finish")
  })

  test("parses response.incomplete as finish with length", () => {
    const event = JSON.stringify({ type: "response.incomplete" })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("finish")
    if (part?.type === "finish") {
      expect(part.finishReason.unified).toBe("length")
    }
  })

  test("parses response.failed as error", () => {
    const event = JSON.stringify({
      type: "response.failed",
      error: { message: "content filter" },
    })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    expect(part!.type).toBe("error")
  })

  test("returns null for unknown event type", () => {
    const event = JSON.stringify({ type: "some.unknown.event" })
    const part = parseCodexSSE(event)

    expect(part).toBeNull()
  })

  test("returns null for non-JSON input", () => {
    const part = parseCodexSSE("not json")
    expect(part).toBeNull()
  })

  test("returns null for empty string", () => {
    const part = parseCodexSSE("")
    expect(part).toBeNull()
  })

  test("returns null for JSON without type field", () => {
    const event = JSON.stringify({ foo: "bar" })
    const part = parseCodexSSE(event)
    expect(part).toBeNull()
  })

  test("maps response.completed usage tokens correctly", () => {
    const event = JSON.stringify({
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 42,
          output_tokens: 99,
          input_tokens_details: { cached_tokens: 10 },
          output_tokens_details: { reasoning_tokens: 30 },
        },
      },
    })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    if (part?.type === "finish") {
      expect(part.usage.inputTokens.total).toBe(42)
      expect(part.usage.outputTokens.total).toBe(99)
    }
  })

  test("response.completed without response.usage defaults usage to 0", () => {
    const event = JSON.stringify({
      type: "response.completed",
      response: {},
    })
    const part = parseCodexSSE(event)

    expect(part).not.toBeNull()
    if (part?.type === "finish") {
      expect(part.usage.inputTokens.total).toBe(0)
      expect(part.usage.outputTokens.total).toBe(0)
    }
  })
})
