// Tests for thinking injection in the Copilot fetch wrapper (Phase 1)
// Verifies that createCopilotFetch injects the `thinking` parameter
// into the request body when thinkingBudget > 0, and exposes
// setThinkingBudget() for runtime toggling.

import { describe, test, expect } from "bun:test"
import { createCopilotFetch } from "../../src/provider/copilot-fetch"

// ---------------------------------------------------------------------------
// Helper — captures the parsed request body sent through the mock fetch
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 1. Injects thinking when thinkingBudget is set
// ---------------------------------------------------------------------------
describe("createCopilotFetch — thinking injection", () => {
  test("injects thinking block when thinkingBudget > 0", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      thinkingBudget: 8000,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4.6", messages: [{ role: "user", content: "hello" }] }),
    })

    const body = mock.capturedBody()
    expect(body).toBeDefined()
    expect(body!.thinking).toEqual({ type: "enabled", budget_tokens: 8000 })
  })

  // ---------------------------------------------------------------------------
  // 2. No thinking key when thinkingBudget is omitted or 0
  // ---------------------------------------------------------------------------
  test("does NOT inject thinking when thinkingBudget is omitted", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      // thinkingBudget not provided
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    })

    const body = mock.capturedBody()
    expect(body!.thinking).toBeUndefined()
  })

  test("does NOT inject thinking when thinkingBudget is 0", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      thinkingBudget: 0,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    })

    const body = mock.capturedBody()
    expect(body!.thinking).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // 3. Original body fields preserved after injection
  // ---------------------------------------------------------------------------
  test("preserves original body fields after thinking injection", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      thinkingBudget: 10000,
    })

    const originalBody = {
      model: "claude-sonnet-4.6",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 4096,
      stream: true,
    }

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify(originalBody),
    })

    const body = mock.capturedBody()
    expect(body!.model).toBe("claude-sonnet-4.6")
    expect(body!.messages).toEqual(originalBody.messages)
    expect(body!.max_tokens).toBe(4096)
    expect(body!.stream).toBe(true)
    // And thinking is injected
    expect(body!.thinking).toEqual({ type: "enabled", budget_tokens: 10000 })
  })

  // ---------------------------------------------------------------------------
  // 4. setThinkingBudget toggles thinking on subsequent calls
  // ---------------------------------------------------------------------------
  test("setThinkingBudget(0) disables thinking on subsequent requests", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      thinkingBudget: 5000,
    })

    // First call — thinking enabled
    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "a" }] }),
    })
    expect(mock.capturedBody()!.thinking).toEqual({ type: "enabled", budget_tokens: 5000 })

    // Disable thinking
    copilotFetch.setThinkingBudget(0)

    // Second call — no thinking
    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "b" }] }),
    })
    expect(mock.capturedBody()!.thinking).toBeUndefined()
  })

  test("setThinkingBudget(N) re-enables thinking after it was disabled", async () => {
    const mock = makeMockFetch()
    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mock.fetch,
      // starts disabled
    })

    // Initially disabled
    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "a" }] }),
    })
    expect(mock.capturedBody()!.thinking).toBeUndefined()

    // Enable with a new budget
    copilotFetch.setThinkingBudget(12000)

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "b" }] }),
    })
    expect(mock.capturedBody()!.thinking).toEqual({ type: "enabled", budget_tokens: 12000 })
  })
})
