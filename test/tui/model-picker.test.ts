import { describe, expect, test } from "bun:test"
import { ActiveProviderSet } from "../../src/provider/active-providers"
import { CatalogRegistry } from "../../src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../src/provider/catalog-snapshot"
import type { ProviderAuthStatus } from "../../src/provider/credentials"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../../src/provider/definitions"
import type { LanguageModel } from "ai"
import { ProviderRegistry, type ProviderAdapter } from "../../src/provider/registry"
import { buildModelPickerOptions } from "../../src/tui/model-picker"
import { buildPickerItems } from "../../src/tui/picker-items"
import { getNextModel, getPrevModel } from "../../src/tui/model-cycle"

function model(id: string, name: string, description: string) {
  return {
    id, name, description, attachment: false, reasoning: false, tool_call: true,
    release_date: "2025-01-01", last_updated: "2025-06-01",
    modalities: { input: ["text"], output: ["text"] }, open_weights: false,
    limit: { context: 100_000, output: 4_000 },
  }
}

function provider(id: string, name: string, models: Record<string, ReturnType<typeof model>>) {
  return { id, name, npm: `@${id}/ai`, env: [`${id.toUpperCase()}_API_KEY`], doc: `https://${id}.example`, models }
}

function adapter(definition: ProviderDefinition): ProviderAdapter {
  return { definition, async createLanguageModel() { return {} as LanguageModel } }
}

function setup(): { active: ActiveProviderSet; catalog: CatalogRegistry } {
  const definitions = [
    { ...BUNDLED_PROVIDER_DEFINITIONS.openai, id: "alpha", catalogProviderId: "alpha", name: "Alpha" },
    { ...BUNDLED_PROVIDER_DEFINITIONS.anthropic, id: "beta", catalogProviderId: "beta", name: "Beta" },
  ] as ProviderDefinition[]
  const providers = new ProviderRegistry()
  for (const definition of definitions) providers.register({ definition, adapter: adapter(definition) })
  const auth = {
    async status({ provider }: { provider: ProviderDefinition }): Promise<ProviderAuthStatus> {
      return { providerId: provider.id, state: provider.id === "alpha" ? "authenticated" : "missing" }
    },
  }
  const active = new ActiveProviderSet(providers, auth)
  const catalog = new CatalogRegistry(createCatalogSnapshot({
    alpha: provider("alpha", "Alpha Catalog", {
      "alpha/exact": model("alpha/exact", "Exact Name", "Concise catalog description"),
    }),
    beta: provider("beta", "Beta Catalog", {
      "beta/hidden": model("beta/hidden", "Hidden", "Not active"),
    }),
    other: provider("other", "Remapped", {
      "other/wrong": model("other/wrong", "Wrong", "Must not be remapped"),
    }),
  }))
  return { active, catalog }
}

describe("catalog model picker", () => {
  test("lists only active providers with exact IDs and catalog display metadata", async () => {
    const { active, catalog } = setup()
    await active.refresh()
    expect(buildModelPickerOptions(active, catalog)).toEqual([{
      id: "alpha/alpha/exact",
      name: "Exact Name",
      detail: "Alpha Catalog · Concise catalog description",
    }])
  })

  test("uses the connection ID for selection and catalog provider metadata for display", async () => {
    const definition: ProviderDefinition = {
      ...BUNDLED_PROVIDER_DEFINITIONS["openai-codex"],
      id: "alpha-connection",
      catalogProviderId: "alpha",
    }
    const providers = new ProviderRegistry()
    providers.register({ definition, adapter: adapter(definition), source: "bundled" })
    const active = new ActiveProviderSet(providers, {
      async status({ provider }) {
        return { providerId: provider.id, state: "authenticated" }
      },
    })
    const catalog = new CatalogRegistry(createCatalogSnapshot({
      alpha: provider("alpha", "Alpha Catalog", {
        exact: model("exact", "Exact Name", "Connection-backed model"),
      }),
    }))

    await active.refresh()

    expect(buildModelPickerOptions(active, catalog)).toEqual([{
      id: "alpha/exact",
      name: "Exact Name",
      detail: "Alpha Catalog · Connection-backed model",
    }])
  })

  test("does not depend on configured favorites", async () => {
    const { active, catalog } = setup()
    await active.refresh()
    expect(buildModelPickerOptions(active, catalog).map((option) => option.id)).not.toContain("openai/favorite")
  })

  test("returns an empty list before authentication activity is available", () => {
    const { active, catalog } = setup()
    expect(buildModelPickerOptions(active, catalog)).toEqual([])
  })

  test("uses the same catalog options for forward and reverse cycling", async () => {
    const { active, catalog } = setup()
    await active.refresh()
    const options = buildModelPickerOptions(active, catalog)
    expect(getNextModel(options, "alpha/alpha/exact")).toBeNull()
    expect(getPrevModel(options, "alpha/alpha/exact")).toBeNull()
  })

  test("filters search by exact option ID or catalog name and preserves current selection", async () => {
    const { active, catalog } = setup()
    await active.refresh()
    const options = buildModelPickerOptions(active, catalog)
    expect(buildPickerItems(options, "alpha/alpha/exact", "exact")).toEqual([{
      id: "alpha/alpha/exact",
      label: "Exact Name",
      detail: "Alpha Catalog · Concise catalog description",
      isCurrent: true,
    }])
    expect(buildPickerItems(options, "alpha/removed", "exact")[0]?.isCurrent).toBe(false)
  })
})
