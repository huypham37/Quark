// Tests for the OpenAI Codex fetch wrapper.
// The wrapper injects Bearer auth on every LLM request, removes x-api-key
// headers, and supports lazy token evaluation.
//
// TARGET SOURCE: src/provider/codex-fetch.ts
// STATUS: Source file DOES NOT EXIST yet — these tests will FAIL at import time.
//
// Pattern: Follows test/provider/copilot-fetch.test.ts mock fetch style.

import { describe, test, expect } from "bun:test"
import { createCodexFetch } from "../../src/provider/codex-fetch"
import type { FetchFn } from "../../src/provider/codex-auth"

// ---------------------------------------------------------------------------
// createCodexFetch — wraps fetch with Bearer auth injection
// ---------------------------------------------------------------------------
describe("createCodexFetch", () => {
  test("injects Authorization: Bearer header from getToken", async () => {
    const captured: { headers?: Record<string, string> } = {}

    const mockFetch: FetchFn = async (_input, init) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => "test-token-abc",
      fetch: mockFetch,
    })

    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    })

    expect(captured.headers?.["authorization"]).toBe("Bearer test-token-abc")
  })

  test("removes x-api-key header if present in request", async () => {
    const captured: { headers?: Record<string, string> } = {}

    const mockFetch: FetchFn = async (_input, init) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => "tok",
      fetch: mockFetch,
    })

    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "should-not-appear",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    })

    expect(captured.headers?.["x-api-key"]).toBeUndefined()
  })

  test("calls getToken lazily on each request", async () => {
    const captured: string[] = []
    let tokenValue = "token-v1"

    const mockFetch: FetchFn = async (_input, init) => {
      captured.push(
        (init?.headers as Record<string, string>)?.["authorization"] ?? "",
      )
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => tokenValue,
      fetch: mockFetch,
    })

    // First request
    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    })

    // Change token between requests (simulates refresh)
    tokenValue = "token-v2"

    // Second request
    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    })

    expect(captured).toEqual(["Bearer token-v1", "Bearer token-v2"])
  })

  test("preserves existing headers from the request", async () => {
    const captured: { headers?: Record<string, string> } = {}

    const mockFetch: FetchFn = async (_input, init) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => "tok",
      fetch: mockFetch,
    })

    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Custom-Header": "custom-value",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    })

    expect(captured.headers?.["content-type"]).toBe("application/json")
    expect(captured.headers?.["custom-header"]).toBe("custom-value")
    expect(captured.headers?.["authorization"]).toBe("Bearer tok")
  })

  test("passes through the HTTP method and body unchanged", async () => {
    let capturedMethod = ""
    let capturedBody: string | null = null

    const mockFetch: FetchFn = async (_input, init) => {
      capturedMethod = init?.method ?? ""
      capturedBody = (init?.body as string) ?? null
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => "tok",
      fetch: mockFetch,
    })

    const requestBody = JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    })

    await codexFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: requestBody,
    })

    expect(capturedMethod).toBe("POST")
    expect(capturedBody).toBe(requestBody)
  })

  test("uses globalThis.fetch when no custom fetch is injected", async () => {
    // When fetch is not provided, the wrapper should fall back to globalThis.fetch
    // We verify the wrapper is callable and returns a Response-like object
    const codexFetch = createCodexFetch({
      getToken: async () => "tok",
    })

    // The wrapper function exists and is callable
    expect(typeof codexFetch).toBe("function")

    // We can't easily verify it calls globalThis.fetch without actually making
    // a request, but we can verify it returns a Promise<Response>
    const result = codexFetch("https://example.com/", { method: "GET" })
    expect(result).toBeInstanceOf(Promise)
  })

  test("handles Request object as input", async () => {
    let capturedUrl = ""

    const mockFetch: FetchFn = async (input, init) => {
      capturedUrl = input instanceof Request ? input.url : input.toString()
      return new Response("{}", { status: 200 })
    }

    const codexFetch = createCodexFetch({
      getToken: async () => "tok",
      fetch: mockFetch,
    })

    const req = new Request("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    })

    await codexFetch(req)

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions")
  })
})
