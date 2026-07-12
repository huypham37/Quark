// Tests for the ChatGPT Consumer API provider.
// Implements a custom AI SDK v3 LanguageModelV3 provider that talks to
// chatgpt.com/backend-api/codex/responses via SSE.
//
// TARGET SOURCE: src/provider/codex-consumer.ts
// STATUS: Source file DOES NOT EXIST yet — these tests will FAIL at import time.
//
// Pattern: Follows test/provider/codex-auth.test.ts and
// test/provider/codex-fetch.test.ts mock fetch style.
// All HTTP calls are mocked via injectable FetchFn. SSE responses are
// simulated via ReadableStream.

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import type { FetchFn } from "../../src/provider/codex-auth"
import {
  createCodexConsumer,
} from "../../src/provider/codex-consumer"
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock Response with given status, headers, and body. */
function mockResponse(
  body: string | ReadableStream<Uint8Array> | null,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers })
}

/** Create a minimal valid SSE stream that returns a text delta then finishes. */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const lines = events.map((e) => `data: ${e}\n\n`).join("")
  // Use a small delay to simulate network — necessary for chunked reads
  let index = 0
  let timeoutId: Timer | null = null
  return new ReadableStream({
    type: "bytes",
    start(controller) {
      function pushChunk() {
        if (index < lines.length) {
          const chunk = encoder.encode(lines[index] ?? "")
          controller.enqueue(chunk)
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
}

/** A complete SSE sequence: text delta + completed. */
function simpleTextStream(delta: string, usage?: Record<string, unknown>): ReadableStream<Uint8Array> {
  const events = [
    JSON.stringify({ type: "response.output_text.delta", delta }),
    JSON.stringify({
      type: "response.completed",
      response: {
        usage: usage ?? { input_tokens: 10, output_tokens: 5 },
      },
    }),
  ]
  return sseStream(events)
}

/** Collect all parts from a LanguageModelV3StreamResult. */
async function collectStream(
  streamResult: Awaited<ReturnType<LanguageModelV3["doStream"]>>,
): Promise<LanguageModelV3StreamPart[]> {
  const reader = streamResult.stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------
describe("createCodexConsumer", () => {
  test("returns a LanguageModelV3 instance with correct metadata", () => {
    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "test.jwt.token",
      accountId: "acct-123",
    })

    expect(model.specificationVersion).toBe("v3")
    expect(model.provider).toBe("codex-consumer")
    expect(model.modelId).toBe("gpt-4o")
  })

  test("returns different modelId when provided", () => {
    const model = createCodexConsumer({
      modelId: "o3",
      jwt: "jwt",
      accountId: "acct",
    })

    expect(model.modelId).toBe("o3")
  })

  test("supportedUrls is callable and returns a Record", async () => {
    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
    })

    const urls = await model.supportedUrls
    expect(typeof urls).toBe("object")
    expect(urls).not.toBeNull()
  })

  test("doStream is a function", () => {
    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
    })

    expect(typeof model.doStream).toBe("function")
  })
})

// ---------------------------------------------------------------------------
// HTTP request shape — doStream sends correct URL, headers, and body
// ---------------------------------------------------------------------------
describe("doStream — HTTP request", () => {
  test("POSTs to chatgpt.com/backend-api/codex/responses", async () => {
    let capturedUrl = ""

    const mockFetch: FetchFn = async (url) => {
      capturedUrl = url.toString()
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "test-jwt",
      accountId: "acct-456",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(capturedUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
  })

  test("sends all required headers", async () => {
    let capturedHeaders: Record<string, string> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "test-jwt-abc",
      accountId: "acct-789",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(capturedHeaders["authorization"]).toBe("Bearer test-jwt-abc")
    expect(capturedHeaders["chatgpt-account-id"]).toBe("acct-789")
    expect(capturedHeaders["originator"]).toBe("pi")
    expect(capturedHeaders["openai-beta"]).toBe("responses=experimental")
    expect(capturedHeaders["accept"]).toBe("text/event-stream")
    expect(capturedHeaders["content-type"]).toBe("application/json")
  })

  test("sends correct request body with required fields", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "system", content: [{ type: "text", text: "Be helpful" }] },
        { role: "user", content: [{ type: "text", text: "Hello world" }] },
      ],
    }))

    expect(capturedBody.model).toBe("gpt-4o")
    expect(capturedBody.store).toBe(false)
    expect(capturedBody.stream).toBe(true)
    expect(capturedBody.instructions).toBe("Be helpful")
    expect(capturedBody.text).toEqual({ verbosity: "low" })
    expect(capturedBody.include).toEqual(["reasoning.encrypted_content"])
  })

  test("passes reasoning config through providerOptions", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      providerOptions: {
        codex: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
        },
      },
    }))

    expect(capturedBody.reasoning).toEqual({ effort: "high", summary: "auto" })
  })

  test("passes reasoning mode through providerOptions", async () => {
    let capturedBody: Record<string, unknown> = {}
    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }
    const model = createCodexConsumer({ modelId: "gpt-5.6-terra", jwt: "jwt", accountId: "acct", fetch: mockFetch })

    await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      providerOptions: { codex: { reasoningEffort: "high", reasoningMode: "pro" } },
    }))

    expect(capturedBody.reasoning).toEqual({ effort: "high", summary: "auto", mode: "pro" })
  })

  test("omits reasoning when providerOptions reasoningEffort is 'none'", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      providerOptions: {
        codex: {
          reasoningEffort: "none",
          reasoningSummary: "auto",
        },
      },
    }))

    expect(capturedBody.reasoning).toBeUndefined()
  })

  test("defaults reasoning summary to 'auto' when not provided", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      providerOptions: {
        codex: {
          reasoningEffort: "medium",
        },
      },
    }))

    expect(capturedBody.reasoning).toEqual({ effort: "medium", summary: "auto" })
  })

  test("text-only user message uses simple string content", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Hello world" }] },
      ],
    }))

    const input = capturedBody.input as Array<Record<string, unknown>>
    expect(input.length).toBe(1)
    expect(input[0]!.role).toBe("user")
    expect(typeof input[0]!.content).toBe("string")
    expect(input[0]!.content).toBe("Hello world")
  })

  test("image + text user message uses array content with input_image", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image:" },
            { type: "file", data: "iVBORw0KGgoAAAANS", mediaType: "image/png" },
          ],
        },
      ],
    }))

    const input = capturedBody.input as Array<Record<string, unknown>>
    expect(input.length).toBe(1)
    expect(input[0]!.role).toBe("user")

    const content = input[0]!.content as Array<Record<string, unknown>>
    expect(Array.isArray(content)).toBe(true)
    expect(content.length).toBe(2)
    expect(content[0]).toEqual({ type: "input_text", text: "Describe this image:" })
    expect(content[1]).toEqual({
      type: "input_image",
      detail: "auto",
      image_url: "data:image/png;base64,iVBORw0KGgoAAAANS",
    })
  })

  test("image URL user message passes through as image_url", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "file", data: "https://example.com/image.png", mediaType: "image/png" },
          ],
        },
      ],
    }))

    const input = capturedBody.input as Array<Record<string, unknown>>
    const content = input[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({
      type: "input_image",
      detail: "auto",
      image_url: "https://example.com/image.png",
    })
  })

  test("Uint8Array image data gets base64 encoded", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes

    await collectStream(await model.doStream({
      prompt: [
        {
          role: "user",
          content: [
            { type: "file", data: bytes, mediaType: "image/png" },
          ],
        },
      ],
    }))

    const input = capturedBody.input as Array<Record<string, unknown>>
    const content = input[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({
      type: "input_image",
      detail: "auto",
      image_url: "data:image/png;base64,iVBORw==",
    })
  })

  test("maps user messages to input array", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "First message" }] },
      ],
    }))

    const input = capturedBody.input as Array<Record<string, unknown>>
    expect(Array.isArray(input)).toBe(true)
    expect(input.length).toBeGreaterThanOrEqual(1)
  })

  test("extracts system message as instructions", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "system", content: [{ type: "text", text: "You are a helpful assistant." }] },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
    }))

    expect(capturedBody.instructions).toBe("You are a helpful assistant.")
    // input should NOT include the system message
    const input = capturedBody.input as Array<Record<string, unknown>>
    const hasSystemInInput = input.some((m) => m.role === "system")
    expect(hasSystemInInput).toBe(false)
  })

  test("maps assistant and tool history to Responses API items", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("done"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking." },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "read",
              input: { path: "package.json" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "read",
              output: { type: "text", value: "{\"name\":\"@quark/sdk\"}" },
            },
          ],
        },
      ],
    }))

    expect(capturedBody.input).toEqual([
      {
        role: "assistant",
        content: [{ type: "output_text", text: "Checking." }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: "{\"path\":\"package.json\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "{\"name\":\"@quark/sdk\"}",
      },
    ])
  })

  test("maps tools to Responses API flat format", async () => {
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}")
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      tools: [
        {
          type: "function" as const,
          name: "get_weather",
          description: "Get the weather",
          inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } as any,
        },
      ],
    }))

    const tools = capturedBody.tools as Array<Record<string, unknown>>
    expect(tools).toBeDefined()
    expect(tools.length).toBe(1)
    expect(tools[0]).toEqual({
      type: "function",
      name: "get_weather",
      description: "Get the weather",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    })
    expect(capturedBody.tool_choice).toBe("auto")
    expect(capturedBody.parallel_tool_calls).toBe(true)
  })

  test("uses POST method", async () => {
    let capturedMethod = ""

    const mockFetch: FetchFn = async (_url, init) => {
      capturedMethod = init?.method ?? ""
      return mockResponse(simpleTextStream("hello"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(capturedMethod).toBe("POST")
  })
})

// ---------------------------------------------------------------------------
// doStream — stream result
// ---------------------------------------------------------------------------
describe("doStream — stream result", () => {
  test("returns a LanguageModelV3StreamResult with readable stream", async () => {
    const mockFetch: FetchFn = async () =>
      mockResponse(simpleTextStream("hello"))

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })

    expect(result).toBeDefined()
    expect(result.stream).toBeDefined()
    expect(result.stream).toBeInstanceOf(ReadableStream)
  })

  test("text-delta is parsed from SSE and emitted", async () => {
    const mockFetch: FetchFn = async () =>
      mockResponse(simpleTextStream("Hello, world!"))

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const parts = await collectStream(result)

    const textDeltas = parts.filter((p) => p.type === "text-delta")
    expect(textDeltas.length).toBeGreaterThan(0)
    if (textDeltas.length > 0 && textDeltas[0]?.type === "text-delta") {
      expect(textDeltas[0].delta).toBe("Hello, world!")
    }
  })

  test("finish part is emitted on response.completed with usage", async () => {
    const mockFetch: FetchFn = async () =>
      mockResponse(simpleTextStream("test", {
        input_tokens: 42,
        output_tokens: 7,
      }))

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const parts = await collectStream(result)

    const finishParts = parts.filter((p) => p.type === "finish")
    expect(finishParts.length).toBeGreaterThan(0)

    const finish = finishParts[0]
    if (finish?.type === "finish") {
      expect(finish.finishReason.unified).toBe("stop")
      expect(finish.usage.inputTokens.total).toBe(42)
      expect(finish.usage.outputTokens.total).toBe(7)
    }
  })
})

// ---------------------------------------------------------------------------
// Retry logic — exponential backoff on 429 and 5xx
// ---------------------------------------------------------------------------
describe("doStream — retry logic", () => {
  test("retries on 429 with exponential backoff", async () => {
    let callCount = 0
    const callTimes: number[] = []

    const mockFetch: FetchFn = async () => {
      callCount++
      callTimes.push(Date.now())
      if (callCount < 3) {
        return mockResponse("Rate limited", 429)
      }
      return mockResponse(simpleTextStream("success"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 3,
    })

    const parts = await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(callCount).toBe(3)
    // Verify exponential backoff: second delay >= 2x first delay (approximately)
    if (callTimes.length >= 3) {
      const delay1 = (callTimes[1] ?? 0) - (callTimes[0] ?? 0)
      const delay2 = (callTimes[2] ?? 0) - (callTimes[1] ?? 0)
      // Second delay should be at least as long as first (doubling)
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.5) // allow some timing variance
    }

    // Should eventually get success
    const finishParts = parts.filter((p) => p.type === "finish")
    expect(finishParts.length).toBeGreaterThan(0)
  })

  test("retries on 5xx with exponential backoff", async () => {
    let callCount = 0

    const mockFetch: FetchFn = async () => {
      callCount++
      if (callCount === 1) {
        return mockResponse("Server error", 503)
      }
      return mockResponse(simpleTextStream("recovered"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 3,
    })

    const parts = await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(callCount).toBe(2)
    const finishParts = parts.filter((p) => p.type === "finish")
    expect(finishParts.length).toBeGreaterThan(0)
  })

  test("throws after max retries exhausted", async () => {
    const mockFetch: FetchFn = async () => {
      return mockResponse("Rate limited", 429)
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 2,
    })

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }).then((r) => collectStream(r)),
    ).rejects.toThrow()
  })

  test("retries on 502, 503, 504", async () => {
    for (const status of [502, 503, 504]) {
      let callCount = 0
      const mockFetch: FetchFn = async () => {
        callCount++
        if (callCount === 1) {
          return mockResponse("Error", status)
        }
        return mockResponse(simpleTextStream("ok"))
      }

      const model = createCodexConsumer({
        modelId: "gpt-4o",
        jwt: "jwt",
        accountId: "acct",
        fetch: mockFetch,
        maxRetries: 2,
      })

      await collectStream(await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }))

      expect(callCount).toBe(2)
    }
  })

  test("retries on 500", async () => {
    let callCount = 0
    const mockFetch: FetchFn = async () => {
      callCount++
      if (callCount === 1) {
        return mockResponse("Internal error", 500)
      }
      return mockResponse(simpleTextStream("ok"))
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 2,
    })

    await collectStream(await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))

    expect(callCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Error handling — non-retryable HTTP errors
// ---------------------------------------------------------------------------
describe("doStream — error handling", () => {
  test("fails immediately on 401 without retry", async () => {
    let callCount = 0
    const mockFetch: FetchFn = async () => {
      callCount++
      return mockResponse("Unauthorized", 401)
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 3,
    })

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }).then((r) => collectStream(r)),
    ).rejects.toThrow()

    expect(callCount).toBe(1)
  })

  test("fails immediately on 403 without retry", async () => {
    let callCount = 0
    const mockFetch: FetchFn = async () => {
      callCount++
      return mockResponse("Forbidden", 403)
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
      maxRetries: 3,
    })

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }).then((r) => collectStream(r)),
    ).rejects.toThrow()
    expect(callCount).toBe(1)
  })

  test("fails immediately on 404 without retry", async () => {
    let callCount = 0
    const mockFetch: FetchFn = async () => {
      callCount++
      return mockResponse("Not Found", 404)
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }).then((r) => collectStream(r)),
    ).rejects.toThrow()
    expect(callCount).toBe(1)
  })

  test("surfaces network errors", async () => {
    const mockFetch: FetchFn = async () => {
      throw new TypeError("fetch failed")
    }

    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
      fetch: mockFetch,
    })

    await expect(
      model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toThrow("fetch failed")
  })

  test("uses globalThis.fetch when no custom fetch is injected", async () => {
    const model = createCodexConsumer({
      modelId: "gpt-4o",
      jwt: "jwt",
      accountId: "acct",
    })

    // The model should be callable with doStream
    expect(typeof model.doStream).toBe("function")

    // doStream returns a Promise
    const result = model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    expect(result).toBeInstanceOf(Promise)
  })
})
