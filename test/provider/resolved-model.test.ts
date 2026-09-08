import { afterEach, describe, expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { clearHooks, registerHook } from "../../src/plugin/registry"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../src/provider/definitions"
import { ProviderRegistry, type ProviderAdapter } from "../../src/provider/registry"
import { resolveModelRuntime } from "../../src/provider/resolver"
import { CatalogRegistry } from "../../src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../src/provider/catalog-snapshot"

function adapter(definition: typeof BUNDLED_PROVIDER_DEFINITIONS.openai): ProviderAdapter {
  return {
    definition,
    async createLanguageModel({ modelId }) {
      return { modelId } as LanguageModel
    },
  }
}

function catalog(): CatalogRegistry {
  return new CatalogRegistry(createCatalogSnapshot({
    openai: {
      id: "openai",
      name: "OpenAI",
      npm: "@ai-sdk/openai",
      env: ["OPENAI_API_KEY"],
      doc: "https://example.test",
      models: {
        "private/model": {
          id: "private/model",
          name: "Private model",
          description: "test",
          attachment: false,
          reasoning: false,
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 1000, output: 100 },
          cost: { input: 1, output: 2 },
        },
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      npm: "@ai-sdk/anthropic",
      env: ["ANTHROPIC_API_KEY"],
      doc: "https://example.test",
      models: {
        "claude-private": {
          id: "claude-private",
          name: "Claude private",
          description: "test",
          attachment: false,
          reasoning: false,
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 1000, output: 100 },
        },
      },
    },
  }))
}

afterEach(() => clearHooks())

describe("resolveModelRuntime", () => {
  test("uses the custom Codex provider-options namespace", () => {
    expect(BUNDLED_PROVIDER_DEFINITIONS["openai-codex"].providerOptionsKey).toBe("codex")
  })

  test("returns canonical identity, runtime metadata, and a pricing snapshot", async () => {
    const registry = new ProviderRegistry()
    const definition = BUNDLED_PROVIDER_DEFINITIONS.openai
    registry.register({ definition, adapter: adapter(definition), source: "bundled" })

    const resolved = await resolveModelRuntime("openai/private/model", "main", { registry, catalog: catalog() })

    expect(resolved.ref).toEqual({
      providerId: "openai",
      modelId: "private/model",
      spec: "openai/private/model",
    })
    expect(resolved.provider.definition).toEqual(definition)
    expect(resolved.providerOptionsKey).toBe("openai")
    expect(resolved.catalogModel.limit).toEqual({ context: 1000, output: 100 })
    expect(resolved.pricingSnapshot).toEqual({
      kind: "metered",
      rates: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
      source: "models.dev",
      asOf: expect.any(Number),
    })
  })

  test("uses post-hook provider and model identity for the complete runtime", async () => {
    const registry = new ProviderRegistry()
    const openai = BUNDLED_PROVIDER_DEFINITIONS.openai
    const anthropic = BUNDLED_PROVIDER_DEFINITIONS.anthropic
    registry.register({ definition: openai, adapter: adapter(openai), source: "bundled" })
    registry.register({ definition: anthropic, adapter: adapter(anthropic as any), source: "bundled" })
    registerHook("provider.request.before", async (_input, output) => {
      output.provider = "anthropic"
      output.model = "claude-private"
    })

    const resolved = await resolveModelRuntime("openai/gpt-4o", "main", { registry, catalog: catalog() })

    expect(resolved.ref.spec).toBe("anthropic/claude-private")
    expect(resolved.provider.definition.id).toBe("anthropic")
    expect(resolved.providerOptionsKey).toBe("anthropic")
    expect(resolved.catalogModel.id).toBe("claude-private")
  })

  test("rejects an exact catalog miss instead of remapping to another provider", async () => {
    const registry = new ProviderRegistry()
    const definition = BUNDLED_PROVIDER_DEFINITIONS.openai
    registry.register({ definition, adapter: adapter(definition), source: "bundled" })

    await expect(resolveModelRuntime("openai/missing/model", "main", {
      registry,
      catalog: catalog(),
    })).rejects.toThrow('Model "openai/missing/model" is not present in the exact catalog.')
  })

  test("keeps identical model IDs scoped to the selected provider", async () => {
    const registry = new ProviderRegistry()
    const definition = BUNDLED_PROVIDER_DEFINITIONS.openai
    registry.register({ definition, adapter: adapter(definition), source: "bundled" })
    const selected = catalog()
    selected.replaceCatalog({
      openai: {
        id: "openai",
        name: "OpenAI",
        npm: "@ai-sdk/openai",
        env: ["OPENAI_API_KEY"],
        doc: "https://example.test",
        models: {
          "shared/model": {
            id: "shared/model",
            name: "OpenAI shared",
            description: "test",
            attachment: false,
            reasoning: false,
            tool_call: true,
            release_date: "2025-01-01",
            last_updated: "2025-01-01",
            modalities: { input: ["text"], output: ["text"] },
            open_weights: false,
            limit: { context: 2000, output: 200 },
            cost: { input: 3, output: 4 },
          },
        },
      },
      other: {
        id: "other",
        name: "Other",
        npm: "@other/ai",
        env: ["OTHER_API_KEY"],
        doc: "https://example.test",
        models: {
          "shared/model": {
            id: "shared/model",
            name: "Other shared",
            description: "test",
            attachment: false,
            reasoning: false,
            tool_call: true,
            release_date: "2025-01-01",
            last_updated: "2025-01-01",
            modalities: { input: ["text"], output: ["text"] },
            open_weights: false,
            limit: { context: 3000, output: 300 },
            cost: { input: 9, output: 10 },
          },
        },
      },
    })

    const resolved = await resolveModelRuntime("openai/shared/model", "main", {
      registry,
      catalog: selected,
    })
    expect(resolved.catalogModel.name).toBe("OpenAI shared")
    expect(resolved.pricingSnapshot).toMatchObject({ rates: { inputPerMillionUsd: 3 } })
  })
})
