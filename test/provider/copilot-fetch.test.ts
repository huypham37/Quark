// Tests for the Copilot fetch wrapper
// This module wraps fetch to inject Copilot-specific headers on every LLM request.

import { describe, test, expect } from "bun:test"
import {
  createCopilotFetch,
  inferInitiator,
  hasVisionContent,
} from "../../src/provider/copilot-fetch"

// ---------------------------------------------------------------------------
// inferInitiator — decides "user" vs "agent" from the request body
// ---------------------------------------------------------------------------
describe("inferInitiator", () => {
  test("returns 'user' when last message role is user (chat/completions)", () => {
    const body = {
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "hello" },
      ],
    }
    expect(inferInitiator(body)).toBe("user")
  })

  test("returns 'agent' when last message role is assistant (chat/completions)", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi", tool_calls: [{ id: "1", type: "function", function: { name: "read", arguments: "{}" } }] },
      ],
    }
    expect(inferInitiator(body)).toBe("agent")
  })

  test("returns 'agent' when last message role is tool (chat/completions)", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "tool", content: "result", tool_call_id: "1" },
      ],
    }
    expect(inferInitiator(body)).toBe("agent")
  })

  test("returns 'user' when last input role is user (responses API)", () => {
    const body = {
      input: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    }
    expect(inferInitiator(body)).toBe("user")
  })

  test("returns 'agent' when last input is not user role (responses API)", () => {
    const body = {
      input: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "function_call", name: "read", arguments: "{}", call_id: "1" },
      ],
    }
    expect(inferInitiator(body)).toBe("agent")
  })

  test("returns 'user' for empty/missing body", () => {
    expect(inferInitiator(undefined)).toBe("user")
    expect(inferInitiator({})).toBe("user")
  })
})

// ---------------------------------------------------------------------------
// hasVisionContent — detects image content in the request body
// ---------------------------------------------------------------------------
describe("hasVisionContent", () => {
  test("detects image_url in chat/completions messages", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
          ],
        },
      ],
    }
    expect(hasVisionContent(body)).toBe(true)
  })

  test("detects input_image in responses API input", () => {
    const body = {
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "what is this?" },
            { type: "input_image", image_url: "data:image/png;base64,..." },
          ],
        },
      ],
    }
    expect(hasVisionContent(body)).toBe(true)
  })

  test("returns false when no images", () => {
    const body = {
      messages: [
        { role: "user", content: "just text" },
      ],
    }
    expect(hasVisionContent(body)).toBe(false)
  })

  test("returns false for empty/missing body", () => {
    expect(hasVisionContent(undefined)).toBe(false)
    expect(hasVisionContent({})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createCopilotFetch — wraps fetch with Copilot headers
// ---------------------------------------------------------------------------
describe("createCopilotFetch", () => {
  test("sets Authorization header from token getter", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "test-token-123",
      fetch: mockFetch as typeof fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })

    expect(captured.headers?.["authorization"]).toBe("Bearer test-token-123")
  })

  test("sets Openai-Intent header", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mockFetch as typeof fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })

    expect(captured.headers?.["openai-intent"]).toBe("conversation-edits")
  })

  test("sets x-initiator based on message context", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mockFetch as typeof fetch,
    })

    // User-initiated request
    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })
    expect(captured.headers?.["x-initiator"]).toBe("user")

    // Agent-initiated request (last message is tool result)
    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", content: "file contents", tool_call_id: "1" },
        ],
      }),
    })
    expect(captured.headers?.["x-initiator"]).toBe("agent")
  })

  test("sets Copilot-Vision-Request when images present", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mockFetch as typeof fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this?" },
              { type: "image_url", image_url: { url: "data:..." } },
            ],
          },
        ],
      }),
    })

    expect(captured.headers?.["copilot-vision-request"]).toBe("true")
  })

  test("does NOT set Copilot-Vision-Request when no images", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mockFetch as typeof fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "no images" }],
      }),
    })

    expect(captured.headers?.["copilot-vision-request"]).toBeUndefined()
  })

  test("removes existing x-api-key header", async () => {
    const captured: { headers?: Record<string, string> } = {}
    const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      )
      return new Response("{}", { status: 200 })
    }

    const copilotFetch = createCopilotFetch({
      getToken: async () => "tok",
      fetch: mockFetch as typeof fetch,
    })

    await copilotFetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: { "x-api-key": "should-be-removed" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })

    expect(captured.headers?.["x-api-key"]).toBeUndefined()
  })
})
