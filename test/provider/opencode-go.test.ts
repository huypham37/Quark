import { afterEach, describe, expect, test } from "bun:test"
import { createProviderAdapter } from "../../src/provider/adapters"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../src/provider/definitions"
import { createOpenCodeGoFetch, openCodeGoApi } from "../../src/provider/opencode-go"

const previousSession = process.env.QUARK_SESSION_ID

afterEach(() => {
  if (previousSession === undefined) delete process.env.QUARK_SESSION_ID
  else process.env.QUARK_SESSION_ID = previousSession
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

  test("identifies Quark and sends the current stable session ID", async () => {
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
})
