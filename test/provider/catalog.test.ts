import { afterEach, describe, expect, test } from "bun:test"
import { ModelRegistry, parseModelRef } from "../../src/provider/catalog"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../src/provider/definitions"
import { __setModelsDevDataForTest } from "../../src/provider/models"

afterEach(() => __setModelsDevDataForTest(null))

describe("parseModelRef", () => {
  test("splits only at the first slash and normalizes only provider ID", () => {
    expect(parseModelRef("OpenRouter/Anthropic/Claude-Sonnet")).toEqual({
      providerId: "openrouter",
      modelId: "Anthropic/Claude-Sonnet",
      spec: "openrouter/Anthropic/Claude-Sonnet",
    })
  })

  test("rejects missing segments", () => {
    expect(() => parseModelRef("gpt-4o")).toThrow()
    expect(() => parseModelRef("openai/")).toThrow()
  })
})

describe("ModelRegistry", () => {
  test("uses provider metadata aliases and subscription billing override", () => {
    __setModelsDevDataForTest({
      "github-copilot": {
        id: "github-copilot",
        models: {
          "claude-sonnet": {
            id: "claude-sonnet",
            name: "Claude Sonnet",
            limit: { context: 200_000, output: 8_000 },
            cost: { input: 3, output: 15 },
          },
        },
      },
    })

    const ref = parseModelRef("copilot/claude-sonnet")
    const descriptor = new ModelRegistry().resolve(ref, BUNDLED_PROVIDER_DEFINITIONS.copilot)

    expect(descriptor.name).toBe("Claude Sonnet")
    expect(descriptor.limits?.context).toBe(200_000)
    expect(descriptor.pricing).toEqual({ kind: "subscription" })
  })

  test("uses exact-provider prices and never falls back across providers", () => {
    __setModelsDevDataForTest({
      openai: {
        id: "openai",
        models: {
          shared: { id: "shared", limit: { context: 100, output: 10 }, cost: { input: 2, output: 4 } },
        },
      },
      openrouter: { id: "openrouter", models: {} },
    })

    const openai = new ModelRegistry().resolve(parseModelRef("openai/shared"), BUNDLED_PROVIDER_DEFINITIONS.openai)
    const openrouter = new ModelRegistry().resolve(parseModelRef("openrouter/shared"), BUNDLED_PROVIDER_DEFINITIONS.openrouter)

    expect(openai.pricing).toMatchObject({ kind: "metered", rates: { inputPerMillionUsd: 2 } })
    expect(openrouter.pricing).toEqual({ kind: "unknown" })
  })

  test("resolves DeepSeek metadata from the exact models.dev provider", () => {
    __setModelsDevDataForTest({
      deepseek: {
        id: "deepseek",
        models: {
          "deepseek-v4-pro": {
            id: "deepseek-v4-pro",
            limit: { context: 1_000_000, output: 384_000 },
            cost: { input: 1, output: 2 },
          },
        },
      },
      openrouter: {
        id: "openrouter",
        models: {
          "deepseek-v4-pro": { id: "deepseek-v4-pro", limit: { context: 10, output: 5 } },
        },
      },
    })

    const descriptor = new ModelRegistry().resolve(
      parseModelRef("deepseek/deepseek-v4-pro"),
      BUNDLED_PROVIDER_DEFINITIONS.deepseek,
    )
    expect(descriptor.limits).toEqual({ context: 1_000_000, output: 384_000 })
    expect(descriptor.pricing).toMatchObject({ kind: "metered", rates: { inputPerMillionUsd: 1 } })
  })

  test("returns a permissive unknown descriptor on catalog miss", () => {
    __setModelsDevDataForTest({})
    const descriptor = new ModelRegistry().resolve(
      parseModelRef("openai/private-model"),
      BUNDLED_PROVIDER_DEFINITIONS.openai,
    )
    expect(descriptor.available).toBe("unknown")
    expect(descriptor.limits).toBeNull()
    expect(descriptor.pricing).toEqual({ kind: "unknown" })
  })
})
