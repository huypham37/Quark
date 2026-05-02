// Tests for the Copilot fetch wrapper — thinking removal verification
// After the refactor, thinking is via providerOptions + ThinkingNormalizer only.
// The fetch wrapper must NOT inject any `thinking` key into the request body.

import { describe, test, expect } from "bun:test"
import { createCopilotFetch } from "../../src/provider/copilot-fetch"

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
