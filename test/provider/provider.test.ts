// Tests for the Copilot provider — model routing + provider creation
// We use @ai-sdk/openai under the hood, pointed at Copilot's API.

import { describe, test, expect } from "bun:test"
import {
  shouldUseResponsesApi,
  createCopilotProvider,
  getModel,
} from "../../src/provider/provider"

// ---------------------------------------------------------------------------
// shouldUseResponsesApi — GPT-5+ (except gpt-5-mini) uses responses API
// ---------------------------------------------------------------------------
describe("shouldUseResponsesApi", () => {
  test("returns true for gpt-5", () => {
    expect(shouldUseResponsesApi("gpt-5")).toBe(true)
  })

  test("returns true for gpt-5-2025-08-07", () => {
    expect(shouldUseResponsesApi("gpt-5-2025-08-07")).toBe(true)
  })

  test("returns true for gpt-5.1", () => {
    expect(shouldUseResponsesApi("gpt-5.1")).toBe(true)
  })

  test("returns true for gpt-5.2-pro", () => {
    expect(shouldUseResponsesApi("gpt-5.2-pro")).toBe(true)
  })

  test("returns false for gpt-5-mini", () => {
    expect(shouldUseResponsesApi("gpt-5-mini")).toBe(false)
  })

  test("returns false for gpt-5-mini-2025-08-07", () => {
    expect(shouldUseResponsesApi("gpt-5-mini-2025-08-07")).toBe(false)
  })

  test("returns false for gpt-4o", () => {
    expect(shouldUseResponsesApi("gpt-4o")).toBe(false)
  })

  test("returns false for gpt-4o-mini", () => {
    expect(shouldUseResponsesApi("gpt-4o-mini")).toBe(false)
  })

  test("returns false for gpt-4.1", () => {
    expect(shouldUseResponsesApi("gpt-4.1")).toBe(false)
  })

  test("returns false for claude-sonnet-4-20250514", () => {
    expect(shouldUseResponsesApi("claude-sonnet-4-20250514")).toBe(false)
  })

  test("returns false for o3", () => {
    expect(shouldUseResponsesApi("o3")).toBe(false)
  })

  test("returns false for o4-mini", () => {
    expect(shouldUseResponsesApi("o4-mini")).toBe(false)
  })

  test("returns true for gpt-6 (future models)", () => {
    expect(shouldUseResponsesApi("gpt-6")).toBe(true)
  })

  test("returns true for gpt-10 (future models)", () => {
    expect(shouldUseResponsesApi("gpt-10")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createCopilotProvider — creates an @ai-sdk/openai instance for Copilot
// ---------------------------------------------------------------------------
describe("createCopilotProvider", () => {
  test("returns a provider object", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    expect(provider).toBeDefined()
  })

  test("provider has chat and responses methods", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    // The @ai-sdk/openai provider exposes .chat() and .responses()
    expect(typeof provider.chat).toBe("function")
    expect(typeof provider.responses).toBe("function")
  })

  test("accepts custom baseURL for enterprise", () => {
    // Should not throw
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
      baseURL: "https://copilot-api.enterprise.example.com",
    })
    expect(provider).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// getModel — routes to chat or responses based on model ID
// ---------------------------------------------------------------------------
describe("getModel", () => {
  test("returns a language model for gpt-4o", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider, "gpt-4o")
    expect(model).toBeDefined()
    expect(model.modelId).toBe("gpt-4o")
  })

  test("returns a language model for gpt-5", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider, "gpt-5")
    expect(model).toBeDefined()
    expect(model.modelId).toBe("gpt-5")
  })

  test("uses chat provider name for non-responses models", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider, "gpt-4o")
    // @ai-sdk/openai chat models have provider string containing "chat"
    expect(model.provider).toContain("chat")
  })

  test("uses responses provider name for GPT-5+ models", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider, "gpt-5")
    // @ai-sdk/openai responses models have provider string containing "responses"
    expect(model.provider).toContain("responses")
  })

  test("uses chat for gpt-5-mini despite being GPT-5", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider, "gpt-5-mini")
    expect(model.provider).toContain("chat")
  })

  test("defaults to gpt-4o when no model ID specified", () => {
    const provider = createCopilotProvider({
      getToken: async () => "test-token",
    })
    const model = getModel(provider)
    expect(model.modelId).toBe("gpt-4o")
  })
})
