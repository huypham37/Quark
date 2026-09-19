import { afterEach, describe, expect, test } from "bun:test"
import { createProviderAdapter } from "../../packages/runner/src/provider/adapters"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../packages/runner/src/provider/definitions"
import { createOpenCodeGoFetch, openCodeGoApi } from "../../packages/runner/src/provider/opencode-go"
import { createRunner } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"

const previousSession = process.env.QUARK_SESSION_ID

afterEach(() => {
  if (previousSession === undefined) delete process.env.QUARK_SESSION_ID
  else process.env.QUARK_SESSION_ID = previousSession
  delete process.env.OPENCODE_API_KEY
})

describe("OpenCode Go", () => {
  test("routes models to their documented API", () => {
    expect(openCodeGoApi("gpt-5.6-luna")).toBe("responses")
    expect(openCodeGoApi("minimax-m3")).toBe("messages")
    expect(openCodeGoApi("kimi-k3")).toBe("chat")
  })

  test("creates the SDK adapter matching each endpoint", async () => {
    const adapter = createProviderAdapter(BUNDLED_PROVIDER_DEFINITIONS["opencode-go"])
    const credential = {
      credential: { type: "api-key" as const, value: "secret" },
      origin: "session" as const,
    }
    const chat = await adapter.createLanguageModel({ modelId: "kimi-k3", credential })
    const messages = await adapter.createLanguageModel({ modelId: "minimax-m3", credential })
    const responses = await adapter.createLanguageModel({ modelId: "gpt-5.6-luna", credential })

    expect(chat.provider).toBe("opencode-go.chat")
    expect(messages.provider).toBe("anthropic.messages")
    expect(responses.provider).toBe("openai.responses")
  })

  test("identifies Quark and falls back to QUARK_SESSION_ID without an explicit id", async () => {
    process.env.QUARK_SESSION_ID = "session-123"
    let captured: Headers | undefined
    const fetch = createOpenCodeGoFetch(async (_input, init) => {
      captured = new Headers(init?.headers)
      return new Response("{}")
    })

    await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
      headers: { "x-existing": "yes" },
    })

    expect(captured?.get("user-agent")).toBe("quark/0.1.0")
    expect(captured?.get("x-opencode-session")).toBe("session-123")
    expect(captured?.get("x-existing")).toBe("yes")
  })

  test("an explicit session id wins over the env and stays stable across requests", async () => {
    process.env.QUARK_SESSION_ID = "env-session"
    const seen: string[] = []
    const fetch = createOpenCodeGoFetch(async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-opencode-session") ?? "")
      return new Response("{}")
    }, "threaded-run")

    await fetch("https://opencode.ai/zen/go/v1/chat/completions")
    await fetch("https://opencode.ai/zen/go/v1/chat/completions")

    expect(seen).toEqual(["threaded-run", "threaded-run"])
  })

  test("two fetches with distinct ids never share a session", async () => {
    delete process.env.QUARK_SESSION_ID
    const seen: string[] = []
    const capture = () =>
      createOpenCodeGoFetch(async (_input, init) => {
        seen.push(new Headers(init?.headers).get("x-opencode-session") ?? "")
        return new Response("{}")
      })
    const fetchA = capture()
    const fetchB = capture()

    await Promise.all([
      fetchA("https://opencode.ai/zen/go/v1/chat/completions"),
      fetchB("https://opencode.ai/zen/go/v1/chat/completions"),
    ])

    expect(seen[0]).not.toBe(seen[1])
  })

  test("createProviderAdapter threads the run session id into the OpenCode Go fetch", async () => {
    process.env.OPENCODE_API_KEY = "secret"
    const original = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (_input: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-opencode-session") ?? "")
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }) as typeof fetch

    try {
      const adapter = createProviderAdapter(BUNDLED_PROVIDER_DEFINITIONS["opencode-go"], {
        sessionId: "run-42",
      })
      const credential = {
        credential: { type: "api-key" as const, value: "secret" },
        origin: "session" as const,
      }
      const model = await adapter.createLanguageModel({ modelId: "kimi-k3", credential })
      await (model as any)
        .doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
        .catch(() => {})
    } finally {
      globalThis.fetch = original
    }

    expect(seen).toContain("run-42")
  })

  test("concurrent runners send distinct x-opencode-session values", async () => {
    process.env.OPENCODE_API_KEY = "secret"
    delete process.env.QUARK_SESSION_ID
    const original = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (_input: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-opencode-session") ?? "")
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }) as typeof fetch

    try {
      const agent = defineAgent({
        id: "go",
        instructions: "x",
        tools: [],
        model: "opencode-go/kimi-k3",
      })
      const a = createRunner({ agent })
      const b = createRunner({ agent })
      await Promise.allSettled([
        a.prompt({ sessionId: "run-a", parts: [{ type: "text", text: "a" }], catalog: openCodeCatalog() }),
        b.prompt({ sessionId: "run-b", parts: [{ type: "text", text: "b" }], catalog: openCodeCatalog() }),
      ])
    } finally {
      globalThis.fetch = original
    }

    expect(new Set(seen)).toEqual(new Set(["run-a", "run-b"]))
  })
})

function openCodeCatalog(): CatalogRegistry {
  return new CatalogRegistry(createCatalogSnapshot({
    "opencode-go": {
      id: "opencode-go",
      name: "OpenCode Go",
      npm: "@ai-sdk/openai-compatible",
      env: ["OPENCODE_API_KEY"],
      doc: "https://opencode.ai/docs",
      models: {
        "kimi-k3": {
          id: "kimi-k3",
          name: "Kimi K3",
          description: "offline test model",
          attachment: false,
          reasoning: false,
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 100_000, output: 4_000 },
        },
      },
    },
  }, { fetchedAt: 1 }))
}
