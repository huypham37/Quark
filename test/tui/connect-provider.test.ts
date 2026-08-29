import { describe, expect, test } from "bun:test"
import { buildConnectProviderRows, safeConnectError } from "../../src/tui/connect-provider"

describe("connect provider display data", () => {
  test("classifies all bundled providers from their definitions", () => {
    const rows = buildConnectProviderRows()
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ["openai", "api-key"],
      ["anthropic", "api-key"],
      ["openrouter", "api-key"],
      ["deepseek", "api-key"],
      ["copilot", "oauth"],
      ["codex", "oauth"],
      ["ollama", "none"],
      ["lmstudio", "none"],
    ])
  })

  test("deduplicates a canonical configured DeepSeek entry", () => {
    const rows = buildConnectProviderRows([
      { providerId: "deepseek", state: "authenticated", origin: "environment" },
    ], {
      deepseek: { base_url: "https://api.deepseek.com", api_key_env: "DEEPSEEK_API_KEY", billing: "metered" },
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
      private: { base_url: "https://example.test/v1", api_key_env: "PRIVATE_API_KEY", billing: "unknown" },
    })
    expect(rows.at(-1)).toMatchObject({
      id: "private",
      kind: "custom",
      detail: "Set PRIVATE_API_KEY",
      environmentVariable: "PRIVATE_API_KEY",
    })
  })

  test("never returns service error contents", () => {
    const secret = "sk-secret-value"
    expect(safeConnectError(new Error(`request failed: ${secret}`))).not.toContain(secret)
  })
})
