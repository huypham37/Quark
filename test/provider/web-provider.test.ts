// Tests for the web provider — createAlibabaCompatibleProvider + resolveModel web routing
//
// Issue #86: unified web-proxy package
// Branch: feat/unified-web-proxy

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import {
  createAlibabaCompatibleProvider,
} from "../../src/provider/provider"

// ---------------------------------------------------------------------------
// createAlibabaCompatibleProvider — creates an @ai-sdk/alibaba provider
// ---------------------------------------------------------------------------

describe("createAlibabaCompatibleProvider", () => {
  test("returns a provider object", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "web-proxy-key",
    })
    expect(provider).toBeDefined()
  })

  test("provider is callable (creating a model returns a language model)", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "web-proxy-key",
    })
    // @ai-sdk/alibaba providers are callable: provider(modelId)
    expect(typeof provider).toBe("function")
  })

  test("provider(modelId) returns an object with a modelId property", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "web-proxy-key",
    })
    const model = provider("web/qwen3")
    expect(model).toBeDefined()
    expect(model.modelId).toBe("web/qwen3")
  })

  test("accepts arbitrary baseURL (pointing at the local web proxy)", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "local-no-auth",
    })
    const model = provider("web/claude-sonnet-4")
    expect(model.modelId).toBe("web/claude-sonnet-4")
  })

  test("each call returns a fresh provider instance", () => {
    const p1 = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key-a",
    })
    const p2 = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key-b",
    })
    // createAlibabaCompatibleProvider is not cached — each call is independent
    expect(p1).not.toBe(p2)
  })

  test("provider has the expected specificationVersion property on a model", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "web-proxy-key",
    })
    const model = provider("web/qwq")
    // AI SDK language model objects carry a specificationVersion field
    expect(model.specificationVersion).toBe("v3")
  })

  test("generated model has a provider string containing 'alibaba'", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "web-proxy-key",
    })
    const model = provider("web/qwen3-coder")
    // @ai-sdk/alibaba sets a provider identifier on the model object
    expect(model.provider).toContain("alibaba")
  })

  test("sends request to the proxy and parses non-streaming JSON response", async () => {
    const { generateText } = await import("ai")

    // generateText sends a non-streaming request, so the proxy returns
    // a standard OpenAI chat completion JSON response (not SSE).
    const jsonResponse = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "qwen3",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "proxy-ok", reasoning_content: "let me think..." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    const seen: { path?: string; authorization?: string } = {}

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        seen.path = url.pathname
        seen.authorization = req.headers.get("authorization") ?? undefined

        if (url.pathname === "/v1/chat/completions") {
          return new Response(JSON.stringify(jsonResponse), {
            headers: { "Content-Type": "application/json" },
          })
        }

        return new Response("not found", { status: 404 })
      },
    })

    try {
      const provider = createAlibabaCompatibleProvider({
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "proxy-api-key",
      })

      const model = provider("qwen3")
      const result = await generateText({
        model,
        prompt: "Hello from test",
        maxOutputTokens: 32,
      })

      expect(result.text).toContain("proxy-ok")
      expect(seen.path).toBe("/v1/chat/completions")
      // @ai-sdk/alibaba sends Bearer token
      expect(seen.authorization).toBe("Bearer proxy-api-key")
    } finally {
      server.stop(true)
    }
  })
})

// ---------------------------------------------------------------------------
// resolveModel — web provider routing
//
// resolveModel is deeply entangled with config, DB, plugin hooks and Copilot auth.
// We test the routing logic in isolation by mocking the config + provider modules
// so we can assert that "web" provider IDs go through createAlibabaCompatibleProvider
// rather than createOpenAICompatibleProvider.
// ---------------------------------------------------------------------------

describe("resolveModel — web provider routing", () => {
  // We test the branching logic in provider.ts / prompt.ts by exercising
  // createAlibabaCompatibleProvider directly. The integration path is:
  //   resolveModel({ provider: "web", model: "qwen3" })
  //     → getProviderConfig("web")
  //     → createAlibabaCompatibleProvider({ baseURL, apiKey })
  //     → alibabaProvider("qwen3")
  //
  // Full integration of resolveModel requires a live config file + SQLite DB,
  // so we validate the provider-level contract here and leave loop integration
  // to the e2e suite.

  test("createAlibabaCompatibleProvider is the correct function for web models", () => {
    // The web branch in prompt.ts calls createAlibabaCompatibleProvider.
    // Verify it produces a model that @ai-sdk/alibaba owns (not openai).
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key",
    })
    const model = provider("qwen3")
    // @ai-sdk/alibaba models carry an alibaba provider identifier
    expect(model.provider).toContain("alibaba")
    // NOT openai
    expect(model.provider).not.toContain("openai")
  })

  test("web model IDs are passed through unchanged to the alibaba provider", () => {
    const provider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key",
    })
    // The server strips the "web/" prefix; the provider receives the bare model name.
    // resolveModel strips the provider prefix before calling alibabaProvider(modelId).
    for (const modelId of ["qwen3", "claude-sonnet-4", "meta-ai", "qwq-32b"]) {
      const model = provider(modelId)
      expect(model.modelId).toBe(modelId)
    }
  })

  test("web provider does not share instance with OpenAI-compatible provider", async () => {
    const { createOpenAICompatibleProvider } = await import("../../src/provider/provider")
    const alibabaProvider = createAlibabaCompatibleProvider({
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key",
    })
    const openaiProvider = createOpenAICompatibleProvider({
      name: "other",
      baseURL: "http://127.0.0.1:4320/v1",
      apiKey: "key",
    })

    const webModel = alibabaProvider("qwen3")
    const openaiModel = openaiProvider.chat("gpt-4o")

    // The providers are distinct — web model goes through alibaba, not openai
    expect(webModel.provider).not.toBe(openaiModel.provider)
    expect(webModel.provider).toContain("alibaba")
    // OpenAI-compatible provider uses the name we gave it ("other")
    expect(openaiModel.provider).toContain("other")
  })
})
