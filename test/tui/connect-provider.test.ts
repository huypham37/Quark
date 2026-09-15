import { describe, expect, test } from "bun:test"
import { buildConnectProviderRows, safeConnectError, searchConnectProviderRows } from "../../src/tui/connect-provider"

describe("connect provider display data", () => {
  test("classifies all bundled providers from their definitions", () => {
    const rows = buildConnectProviderRows()
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ["openai", "api-key"],
      ["anthropic", "api-key"],
      ["openrouter", "api-key"],
      ["deepseek", "api-key"],
      ["opencode-go", "api-key"],
      ["copilot", "oauth"],
      ["openai-codex", "oauth"],
      ["ollama", "none"],
      ["lmstudio", "none"],
    ])
  })

  test("deduplicates a canonical configured DeepSeek entry", () => {
    const rows = buildConnectProviderRows([
      { providerId: "deepseek", state: "authenticated", origin: "environment" },
    ], {
      deepseek: { base_url: "https://api.deepseek.com", api_key: "env:DEEPSEEK_API_KEY" },
    })
    expect(rows.filter((row) => row.id === "deepseek")).toEqual([expect.objectContaining({
      name: "DeepSeek",
      kind: "api-key",
      status: "authenticated",
      credentialOrigin: "environment",
    })])
  })

  test("shows custom providers as read-only environment instructions", () => {
    const rows = buildConnectProviderRows([], {
      private: { base_url: "https://example.test/v1", api_key: "env:PRIVATE_API_KEY" },
      inline: { base_url: "https://inline.test/v1", api_key: "sk-inline" },
    })
    expect(rows.at(-2)).toMatchObject({
      id: "private",
      kind: "custom",
      detail: "Set PRIVATE_API_KEY",
      environmentVariable: "PRIVATE_API_KEY",
    })
    expect(rows.at(-1)).toMatchObject({
      id: "inline",
      kind: "custom",
      detail: "API key configured",
      environmentVariable: undefined,
    })
  })

  test("filters providers by name, ID, or authentication detail", () => {
    const providers = buildConnectProviderRows()
    expect(searchConnectProviderRows(providers, "deep").map((provider) => provider.id)).toEqual(["deepseek"])
    expect(searchConnectProviderRows(providers, "oauth").map((provider) => provider.id)).toEqual(["copilot", "openai-codex"])
    expect(searchConnectProviderRows(providers, "")).toBe(providers)
  })

  test("never returns service error contents", () => {
    const secret = "sk-secret-value"
    expect(safeConnectError(new Error(`request failed: ${secret}`))).not.toContain(secret)
  })
})
