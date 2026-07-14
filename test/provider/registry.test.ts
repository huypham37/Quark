import { describe, expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../../src/provider/definitions"
import {
  ProviderRegistry,
  createBundledProviderRegistry,
  type ProviderAdapter,
} from "../../src/provider/registry"

function adapter(definition: ProviderDefinition): ProviderAdapter {
  return {
    definition,
    async createLanguageModel() {
      return {} as LanguageModel
    },
  }
}

describe("bundled provider definitions", () => {
  test("include all initial V2 providers with trusted OpenRouter metadata", () => {
    expect(Object.keys(BUNDLED_PROVIDER_DEFINITIONS)).toEqual([
      "openai", "anthropic", "openrouter", "copilot", "codex", "ollama", "lmstudio",
    ])
    expect(BUNDLED_PROVIDER_DEFINITIONS.openrouter.defaultEndpoint).toBe("https://openrouter.ai/api/v1")
    expect(BUNDLED_PROVIDER_DEFINITIONS.openrouter.auth.environmentVariables).toEqual(["OPENROUTER_API_KEY"])
    expect(BUNDLED_PROVIDER_DEFINITIONS.copilot.metadataProviderId).toBe("github-copilot")
    expect(BUNDLED_PROVIDER_DEFINITIONS.copilot.billing).toBe("subscription")
  })
})

describe("ProviderRegistry", () => {
  test("looks up provider IDs case-insensitively", () => {
    const registry = createBundledProviderRegistry(adapter)
    expect(registry.require("OpenRouter").definition.id).toBe("openrouter")
  })

  test("rejects configured or plugin collisions with bundled providers", () => {
    const registry = createBundledProviderRegistry(adapter)
    const definition = BUNDLED_PROVIDER_DEFINITIONS.openai

    expect(() => registry.register({
      definition,
      adapter: adapter(definition),
      source: "plugin",
    })).toThrow(/already registered by bundled/i)
  })

  test("rejects case-insensitive duplicate registrations", () => {
    const registry = new ProviderRegistry()
    const first: ProviderDefinition = {
      ...BUNDLED_PROVIDER_DEFINITIONS.openrouter,
      id: "company-router",
      name: "Company Router",
    }
    const duplicate = { ...first, id: "Company-Router" }
    registry.register({ definition: first, adapter: adapter(first), source: "plugin" })

    expect(() => registry.register({
      definition: duplicate,
      adapter: adapter(duplicate),
      source: "configured",
    })).toThrow(/already registered/i)
  })

  test("rejects reserved and malformed provider IDs", () => {
    const registry = new ProviderRegistry()
    for (const id of ["compaction", "bad_provider", "bad provider"]) {
      const definition = { ...BUNDLED_PROVIDER_DEFINITIONS.openrouter, id }
      expect(() => registry.register({
        definition,
        adapter: adapter(definition),
        source: "plugin",
      })).toThrow()
    }
  })
})
