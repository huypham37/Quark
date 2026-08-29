// Tests for the Copilot fetch wrapper — thinking removal verification
// After the refactor, thinking is via providerOptions + ThinkingNormalizer only.
// The fetch wrapper must NOT inject any `thinking` key into the request body.
//
// Also tests end-to-end: thinking providerOptions land in the actual HTTP request body.

import { describe, test, expect } from "bun:test"
import { createCopilotFetch } from "../../src/provider/copilot-fetch"
import { ThinkingNormalizer } from "../../src/provider/thinking"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, stepCountIs, tool } from "ai"
import { z } from "zod"

function makeMockFetch(): {
  capturedBody: () => Record<string, unknown> | undefined
  fetch: typeof fetch
} {
  let _body: Record<string, unknown> | undefined

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      try { _body = JSON.parse(init.body) } catch { _body = undefined }
    }
    return new Response("{}", { status: 200 })
  }

  return {
    capturedBody: () => _body,
    fetch: mockFetch as typeof fetch,
  }
}

describe("createCopilotFetch — no thinking body injection", () => {
  test("does NOT inject thinking key into body", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "hello" }] }),
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    expect(body!.thinking).toBeUndefined()
  })

  test("preserves all original body fields", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
    })

    const originalBody = {
      model: "gpt-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 4096,
      stream: true,
      temperature: 0.7,
    }

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(originalBody),
    })

    const body = mock.capturedBody()
    expect(body!.model).toBe("gpt-5")
    expect(body!.messages).toEqual(originalBody.messages)
    expect(body!.max_tokens).toBe(4096)
    expect(body!.stream).toBe(true)
    expect(body!.temperature).toBe(0.7)
    expect(body!.thinking).toBeUndefined()
  })

  test("does not have setThinkingBudget method", () => {
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
    })
    expect((copilotFetch as Record<string, unknown>).setThinkingBudget).toBeUndefined()
  })

  test("still has setForceAgent method", () => {
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
    })
    expect(typeof copilotFetch.setForceAgent).toBe("function")
  })
})

// ── End-to-end: thinking fields in actual HTTP request body ────────────────

function makeCompletionResponse(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 123,
      model: "test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function makeCapturingFetch(): {
  capturedBody: () => Record<string, unknown> | undefined
  capturedUrl: () => string
  fetch: typeof fetch
} {
  let _body: Record<string, unknown> | undefined
  let _url = ""

  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    _url = typeof _input === "string" ? _input : _input instanceof URL ? _input.toString() : _input.url
    if (init?.body && typeof init.body === "string") {
      try { _body = JSON.parse(init.body) } catch { _body = undefined }
    }
    return makeCompletionResponse("ok")
  }

  return { capturedBody: () => _body, capturedUrl: () => _url, fetch: mockFetch as typeof fetch }
}

describe("thinking providerOptions land in request body", () => {
  test("gpt-5 — reasoning_effort (mapped) + reasoningSummary in body", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({
      name: "test",
      baseURL: "https://mock.example.com/v1",
      apiKey: "test",
      fetch: mock.fetch,
    })

    const normalizer = new ThinkingNormalizer("gpt-5")
    normalizer.configure({ effort: "high" })

    await generateText({
      model: provider("gpt-5"),
      prompt: "Hello",
      providerOptions: normalizer.normalize("test"),
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    // SDK maps reasoningEffort → reasoning_effort in the request body
    expect(body!.reasoning_effort).toBe("high")
    expect(body!.reasoningSummary).toBe("auto")
  })

  test("qwen3-max — enable_thinking in body", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({
      name: "test",
      baseURL: "https://mock.example.com/v1",
      apiKey: "test",
      fetch: mock.fetch,
    })

    const normalizer = new ThinkingNormalizer("qwen3-max")
    normalizer.configure({ effort: "thinking" })

    await generateText({
      model: provider("qwen3-max"),
      prompt: "Hello",
      providerOptions: normalizer.normalize("test"),
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    expect(body!.enable_thinking).toBe(true)
  })

  test("deepseek-v4-pro — reasoning_effort + thinking toggle in body", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({
      name: "test",
      baseURL: "https://mock.example.com/v1",
      apiKey: "test",
      fetch: mock.fetch,
    })

    const normalizer = new ThinkingNormalizer("deepseek-v4-pro")
    normalizer.configure({ effort: "max" })

    await generateText({
      model: provider("deepseek-v4-pro"),
      prompt: "Hello",
      providerOptions: normalizer.normalize("test"),
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    // SDK maps reasoningEffort → reasoning_effort in the request body
    expect(body!.reasoning_effort).toBe("max")
    expect(body!.thinking).toEqual({ type: "enabled" })
  })

  test("DeepSeek reasoning_content is preserved across an executed tool loop", async () => {
    const bodies: Record<string, any>[] = []
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      const first = bodies.length === 1
      return new Response(JSON.stringify({
        id: `chatcmpl-${bodies.length}`,
        object: "chat.completion",
        created: 123,
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: first
            ? {
                role: "assistant",
                content: null,
                reasoning_content: "I should inspect the requested path.",
                tool_calls: [{
                  id: "call-1",
                  type: "function",
                  function: { name: "readPath", arguments: JSON.stringify({ path: "README.md" }) },
                }],
              }
            : { role: "assistant", content: "done" },
          finish_reason: first ? "tool_calls" : "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const provider = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "test",
      fetch: mockFetch as typeof fetch,
    })

    const result = await generateText({
      model: provider("deepseek-v4-pro"),
      prompt: "Read the file",
      stopWhen: stepCountIs(2),
      tools: {
        readPath: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => `contents of ${path}`,
        }),
      },
    })

    expect(result.text).toBe("done")
    expect(bodies).toHaveLength(2)
    expect(bodies[1]!.messages).toContainEqual(expect.objectContaining({
      role: "assistant",
      reasoning_content: "I should inspect the requested path.",
      tool_calls: [expect.objectContaining({ id: "call-1" })],
    }))
    expect(bodies[1]!.messages).toContainEqual(expect.objectContaining({
      role: "tool",
      tool_call_id: "call-1",
    }))
  })

  test("DeepSeek non-thinking requests explicitly disable its default thinking mode", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "test",
      fetch: mock.fetch,
    })
    const normalizer = new ThinkingNormalizer("deepseek-v4-flash")

    await generateText({
      model: provider("deepseek-v4-flash"),
      prompt: "Hello",
      providerOptions: normalizer.normalize("deepseek"),
    })

    expect(mock.capturedBody()!.thinking).toEqual({ type: "disabled" })
  })

  test("gpt-5.6 — default standard mode and effort reach the body", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({ name: "test", baseURL: "https://mock.example.com/v1", apiKey: "test", fetch: mock.fetch })
    const normalizer = new ThinkingNormalizer("gpt-5.6")
    normalizer.configure({ effort: "high" })

    await generateText({ model: provider("gpt-5.6"), prompt: "Hello", providerOptions: normalizer.normalize("test") })

    const body = mock.capturedBody()!
    expect(body.reasoning_effort).toBe("high")
    expect(body.reasoningMode).toBe("standard")
  })

  test("no thinking fields when effort is none", async () => {
    const mock = makeCapturingFetch()
    const provider = createOpenAICompatible({
      name: "test",
      baseURL: "https://mock.example.com/v1",
      apiKey: "test",
      fetch: mock.fetch,
    })

    const normalizer = new ThinkingNormalizer("gpt-5")
    normalizer.configure({ effort: "none" })

    const opts = normalizer.normalize("test")
    expect(opts).toBeUndefined()

    await generateText({
      model: provider("gpt-5"),
      prompt: "Hello",
      providerOptions: undefined,
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    expect(body!.reasoning_effort).toBeUndefined()
    expect(body!.reasoningSummary).toBeUndefined()
  })
})
