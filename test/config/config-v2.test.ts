import { afterAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "yaml"
import {
  parseConfigV2,
  parseCustomProviders,
  providerCredentialSource,
  serializeConfig,
  writeConfigV2,
} from "../../src/config/config"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quark-config-v2-"))
const file = path.join(directory, "config.yaml")
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

function representativeConfig() {
  return {
    version: 2,
    models: {
      small: "openai/gpt-5-mini",
    },
    providers: {
      "quark-go": {
        base_url: "https://api.quark-go.example/v1/",
        api_key: "env:QUARK_GO_API_KEY",
      },
    },
  }
}

describe("Config V2", () => {
  test("parses and serializes a custom provider", () => {
    const loaded = parseConfigV2(representativeConfig())
    expect(loaded.providers["quark-go"]).toEqual({
      base_url: "https://api.quark-go.example/v1",
      api_key: "env:QUARK_GO_API_KEY",
    })
    const serialized = serializeConfig(loaded)
    expect(serialized).toContain("small: openai/gpt-5-mini")
    expect(serialized).not.toContain("favorites:")
    expect(serialized).not.toContain("credential:")
    expect(serialized).not.toContain("protocol:")
    expect(serialized).not.toContain("api_key_env")
  })

  test("maps provider api_key references onto credential sources", () => {
    expect(providerCredentialSource({ base_url: "https://x.example", api_key: "env:A_B" }))
      .toEqual({ source: "environment", variable: "A_B" })
    expect(providerCredentialSource({ base_url: "https://x.example", api_key: "sk-literal" }))
      .toEqual({ source: "inline", value: "sk-literal" })
    expect(providerCredentialSource({ base_url: "https://x.example" })).toEqual({ source: "none" })
  })

  test("accepts a literal api_key so it can be read directly", () => {
    const providers = parseCustomProviders({
      local: { base_url: "https://local.example/v1", api_key: "lm-studio" },
    })
    expect(providers.local).toEqual({ base_url: "https://local.example/v1", api_key: "lm-studio" })
  })

  test("omits api_key for keyless endpoints", () => {
    const providers = parseCustomProviders({ local: { base_url: "http://127.0.0.1:1234/v1" } })
    expect(providers.local).toEqual({ base_url: "http://127.0.0.1:1234/v1" })
  })

  test("ignores obsolete favorites", () => {
    const raw = representativeConfig() as Record<string, any>
    raw.models.favorites = ["openai/old-model"]
    const config = parseConfigV2(raw)
    expect(config.modelConfig).toEqual({ small: "openai/gpt-5-mini" })
    expect((config as Record<string, unknown>).models).toBeUndefined()
    expect(serializeConfig(config)).not.toContain("favorites:")
  })

  test("preserves an optional editor setting", () => {
    const raw = representativeConfig() as Record<string, unknown>
    raw.editor = "code"
    const config = parseConfigV2(raw)
    expect(config.editor).toBe("code")
    expect(serializeConfig(config)).toContain("editor: code")
  })

  test("round-trips profiles and default_profile during unrelated writes", () => {
    const raw = representativeConfig() as Record<string, any>
    raw.default_profile = "general"
    raw.profiles = { general: { name: "General", model: "openai/gpt-5.6-terra", thinking_effort: "high" } }
    const config = parseConfigV2(raw)
    const reparsed = parse(serializeConfig(config)) as Record<string, any>
    expect(reparsed.default_profile).toBe("general")
    expect(reparsed.profiles.general.thinking_effort).toBe("high")
  })

  test("rejects provider secret fields without echoing their values", () => {
    const secret = "sk-must-never-appear"
    const raw = representativeConfig() as any
    raw.providers["quark-go"].apiKey = secret
    let message = ""
    try { parseConfigV2(raw) } catch (error) { message = String(error) }
    expect(message).toContain("forbidden")
    expect(message).not.toContain(secret)
  })

  test("rejects removed provider keys", () => {
    expect(() => parseCustomProviders({ bad: {
      base_url: "https://example.com/v1",
      credential: { source: "store" },
    } })).toThrow(/providers\.bad\.credential is not supported/)
    expect(() => parseCustomProviders({ bad: {
      protocol: "openai-compatible",
      endpoint: "https://example.com/v1",
    } })).toThrow(/providers\.bad\.protocol is not supported/)
  })

  test("validates environment references, api_key shape, and endpoint user-info", () => {
    expect(() => parseCustomProviders({ bad: {
      base_url: "https://example.com/v1",
      api_key: "env:not-valid",
    } })).toThrow(/uppercase environment-variable/)
    expect(() => parseCustomProviders({ bad: {
      base_url: "https://example.com/v1",
      api_key: "   ",
    } })).toThrow(/non-empty API key/)
    expect(() => parseCustomProviders({ bad: {
      base_url: "https://secret@example.com/v1",
      api_key: "env:BAD_API_KEY",
    } })).toThrow(/user-info/)
  })

  test("accepts canonical legacy DeepSeek input with a deprecation and rejects proxies", () => {
    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (message?: unknown) => warnings.push(String(message))
    try {
      const providers = parseCustomProviders({
        deepseek: {
          base_url: "https://api.deepseek.com/",
          api_key: "env:DEEPSEEK_API_KEY",
        },
      })
      expect(providers.deepseek?.base_url).toBe("https://api.deepseek.com")
      expect(parseCustomProviders({
        deepseek: {
          base_url: "https://api.deepseek.com/v1",
          api_key: "env:DEEPSEEK_API_KEY",
        },
      }).deepseek).toEqual({
        base_url: "https://api.deepseek.com/v1",
        api_key: "env:DEEPSEEK_API_KEY",
      })
    } finally {
      console.warn = originalWarn
    }
    expect(warnings.join("\n")).toContain("remove providers.deepseek")

    expect(() => parseCustomProviders({
      deepseek: {
        base_url: "https://proxy.example.com/deepseek/v1",
        api_key: "env:COMPANY_DEEPSEEK_KEY",
      },
    })).toThrow(/rename.*company-deepseek/i)
  })

  test("atomic V2 writer leaves no temporary file", () => {
    writeConfigV2(parseConfigV2(representativeConfig()), file)
    expect(fs.readdirSync(directory).filter((name) => name.includes(".tmp."))).toEqual([])
  })
})
