import { describe, expect, test } from "bun:test"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../../packages/runner/src/provider/definitions"
import { encodeCatalogReasoning } from "../../packages/runner/src/provider/reasoning"
import type { CatalogModel } from "../../packages/runner/src/provider/catalog-snapshot"

function model(
  reasoning_options: CatalogModel["reasoning_options"],
  reasoning = true,
): CatalogModel {
  return {
    id: "nested/reasoner",
    name: "Reasoner",
    description: "test model",
    attachment: false,
    reasoning,
    reasoning_options,
    tool_call: true,
    release_date: "2025-01-01",
    last_updated: "2025-01-01",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 1000, output: 100 },
  }
}

function config(effort: string, budgetTokens?: number) {
  return { effort, mode: "standard", modeExplicit: false, budgetTokens }
}

describe("catalog reasoning encoding", () => {
  test("encodes effort options using the owning adapter namespace", () => {
    const result = encodeCatalogReasoning({
      definition: BUNDLED_PROVIDER_DEFINITIONS.openai,
      model: model([{ type: "effort", values: ["low", "high"] }]),
      config: config("high"),
    })
    expect(result).toEqual({ openai: { reasoningEffort: "high", reasoningSummary: "auto" } })
  })

  test("encodes toggle options and rejects invalid toggle effort", () => {
    const definition = { ...BUNDLED_PROVIDER_DEFINITIONS.openai, providerOptionsKey: "company-router" }
    expect(encodeCatalogReasoning({
      definition,
      model: model([{ type: "toggle" }]),
      config: config("thinking"),
    })).toEqual({ "company-router": { enable_thinking: true } })
    expect(() => encodeCatalogReasoning({
      definition,
      model: model([{ type: "toggle" }]),
      config: config("high"),
    })).toThrow(/toggle model/)
  })

  test("encodes and validates budget token options", () => {
    const definition = BUNDLED_PROVIDER_DEFINITIONS.anthropic
    expect(encodeCatalogReasoning({
      definition,
      model: model([{ type: "budget_tokens", min: 100, max: 500 }]),
      config: config("thinking", 250),
    })).toEqual({ anthropic: { thinking: { type: "enabled", budget_tokens: 250 } } })
    expect(() => encodeCatalogReasoning({
      definition,
      model: model([{ type: "budget_tokens", min: 100, max: 500 }]),
      config: config("thinking", 50),
    })).toThrow(/below the minimum/)
    expect(() => encodeCatalogReasoning({
      definition,
      model: model([{ type: "budget_tokens", min: 100, max: 500 }]),
      config: config("thinking", 501),
    })).toThrow(/exceeds the maximum/)
  })

  test("uses protocol plus catalog effort type for Anthropic wire encoding", () => {
    expect(encodeCatalogReasoning({
      definition: BUNDLED_PROVIDER_DEFINITIONS.anthropic,
      model: model([{ type: "effort", values: ["low"] }]),
      config: config("low"),
    })).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "low" } })
  })

  test("rejects unsupported reasoning without a catalog option", () => {
    expect(() => encodeCatalogReasoning({
      definition: BUNDLED_PROVIDER_DEFINITIONS.openai,
      model: model(undefined, false),
      config: config("high"),
    })).toThrow(/not supported/)
    expect(encodeCatalogReasoning({
      definition: BUNDLED_PROVIDER_DEFINITIONS.openai,
      model: model(undefined),
      config: config("none"),
    })).toBeUndefined()
  })
})
