import { afterAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "yaml"
import {
  migrateConfigToV2,
  parseConfigV2,
  parseCustomProviders,
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
      main: "openrouter/anthropic/claude-sonnet-4.6",
      small: "openai/gpt-5-mini",
      favorites: ["openrouter/anthropic/claude-sonnet-4.6"],
    },
    providers: {
      "quark-go": {
        protocol: "openai-compatible",
        endpoint: "https://api.quark-go.example/v1/",
        credential: { source: "environment", variable: "QUARK_GO_API_KEY" },
        billing: "subscription",
      },
    },
  }
}

describe("Config V2", () => {
  test("parses and serializes nested models and a subscription API-key provider", () => {
    const loaded = parseConfigV2(representativeConfig())
    expect(loaded.modelConfig.main).toBe("openrouter/anthropic/claude-sonnet-4.6")
    expect(loaded.main_model).toBe(loaded.modelConfig.main)
    expect(loaded.providers["quark-go"]).toEqual({
      protocol: "openai-compatible",
      endpoint: "https://api.quark-go.example/v1",
      credential: { source: "environment", variable: "QUARK_GO_API_KEY" },
      billing: "subscription",
    })
    expect(serializeConfig(loaded)).not.toContain("main_model")
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

  test("validates environment names and rejects endpoint user-info", () => {
    expect(() => parseCustomProviders({ bad: {
      protocol: "openai-compatible",
      endpoint: "https://example.com/v1",
      credential: { source: "environment", variable: "not-valid" },
      billing: "unknown",
    } })).toThrow(/uppercase environment-variable/)
    expect(() => parseCustomProviders({ bad: {
      protocol: "openai-compatible",
      endpoint: "https://secret@example.com/v1",
      credential: { source: "none" },
      billing: "free",
    } })).toThrow(/user-info/)
  })

  test("migrates V1 env references without persisting literal secrets", () => {
    const secret = "literal-secret-value"
    fs.writeFileSync(file, `main_model: gpt-4o\nsmall_model: gpt-4o-mini\nmodels: [gpt-4o]\nproviders:\n  openrouter:\n    baseURL: https://openrouter.ai/api/v1\n    apiKey: env:OPENROUTER_API_KEY\n  company:\n    baseURL: https://company.example/v1\n    apiKey: ${secret}\n`)

    const migrated = migrateConfigToV2(file)
    const persisted = fs.readFileSync(file, "utf8")
    const parsed = parse(persisted) as Record<string, any>
    expect(migrated.legacy).toBe(false)
    expect(parsed.version).toBe(2)
    expect(parsed.providers.openrouter).toBeUndefined()
    expect(parsed.providers.company.credential).toEqual({ source: "prompt" })
    expect(persisted).not.toContain(secret)
    expect(persisted).not.toContain("apiKey")
  })

  test("atomic V2 writer leaves no temporary file", () => {
    writeConfigV2(parseConfigV2(representativeConfig()), file)
    expect(fs.readdirSync(directory).filter((name) => name.includes(".tmp."))).toEqual([])
  })
})
