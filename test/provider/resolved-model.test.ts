import { afterEach, describe, expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { clearHooks, registerHook } from "../../src/plugin/registry"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../src/provider/definitions"
import { ProviderRegistry, type ProviderAdapter } from "../../src/provider/registry"
import { resolveModelRuntime } from "../../src/provider/resolver"

function adapter(definition: typeof BUNDLED_PROVIDER_DEFINITIONS.openai): ProviderAdapter {
  return {
    definition,
    async createLanguageModel({ modelId }) {
      return { modelId } as LanguageModel
    },
  }
}

afterEach(() => clearHooks())

describe("resolveModelRuntime", () => {
  test("uses the custom Codex provider-options namespace", () => {
    expect(BUNDLED_PROVIDER_DEFINITIONS.codex.providerOptionsKey).toBe("codex")
  })

  test("returns canonical identity, runtime metadata, and a pricing snapshot", async () => {
    const registry = new ProviderRegistry()
    const definition = BUNDLED_PROVIDER_DEFINITIONS.openai
    registry.register({ definition, adapter: adapter(definition), source: "bundled" })

    const resolved = await resolveModelRuntime("openai/private/model", "main", { registry })

    expect(resolved.ref).toEqual({
      providerId: "openai",
      modelId: "private/model",
      spec: "openai/private/model",
    })
    expect(resolved.provider.definition).toEqual(definition)
    expect(resolved.providerOptionsKey).toBe("openai")
    expect(resolved.pricingSnapshot).not.toBe(resolved.descriptor.pricing)
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

    const resolved = await resolveModelRuntime("openai/gpt-4o", "main", { registry })

    expect(resolved.ref.spec).toBe("anthropic/claude-private")
    expect(resolved.provider.definition.id).toBe("anthropic")
    expect(resolved.providerOptionsKey).toBe("anthropic")
  })
})
