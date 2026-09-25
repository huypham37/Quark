import { describe, expect, test } from "bun:test"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"

function model(id: string, name = id) {
  return {
    id,
    name,
    description: `${name} description`,
    attachment: false,
    reasoning: false,
    tool_call: false,
    release_date: "2025-01-01",
    last_updated: "2025-06-01",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 100_000, output: 4_000 },
  }
}

function provider(id: string, models: Record<string, ReturnType<typeof model>>) {
  return {
    id,
    name: `${id} provider`,
    npm: `@${id}/ai`,
    env: [`${id.toUpperCase()}_API_KEY`],
    doc: `https://${id}.example/docs`,
    models,
  }
}

function snapshot(suffix = "old") {
  return createCatalogSnapshot({
    alpha: provider("alpha", {
      "alpha/z-model": model("alpha/z-model", `${suffix} z`),
      "alpha/a-model": model("alpha/a-model", `${suffix} a`),
    }),
    beta: provider("beta", {
      "beta/shared": model("beta/shared", `${suffix} beta`),
    }),
  }, { fetchedAt: suffix === "old" ? 1 : 2 })
}

function replacementSnapshot() {
  return createCatalogSnapshot({
    gamma: provider("gamma", {
      "gamma/new-model": model("gamma/new-model", "new model"),
    }),
  }, { fetchedAt: 2 })
}

describe("CatalogRegistry", () => {
  test("looks up and lists exact provider and model IDs", () => {
    const registry = new CatalogRegistry(snapshot())

    expect(registry.getProvider("alpha")?.id).toBe("alpha")
    expect(registry.getProvider("Alpha")).toBeNull()
    expect(registry.getModel("alpha", "alpha/z-model")?.id).toBe("alpha/z-model")
    expect(registry.getModel("alpha", "z-model")).toBeNull()
    expect(registry.getModel("beta", "alpha/z-model")).toBeNull()
    expect(registry.getModel("missing", "beta/shared")).toBeNull()
  })

  test("returns immutable records and deterministic catalog-order collections", () => {
    const registry = new CatalogRegistry(snapshot())
    const providers = registry.listProviders()
    const models = registry.listModels("alpha")

    expect(providers.map((entry) => entry.id)).toEqual(["alpha", "beta"])
    expect(models.map((entry) => entry.id)).toEqual(["alpha/z-model", "alpha/a-model"])
    expect(registry.listModels("missing")).toEqual([])
    expect(Object.isFrozen(providers)).toBe(true)
    expect(Object.isFrozen(models)).toBe(true)
    expect(Object.isFrozen(providers[0])).toBe(true)
    expect(Object.isFrozen(models[0])).toBe(true)
    expect(() => (providers as unknown as { push: (provider: unknown) => void }).push(providers[0])).toThrow()
    expect(() => (models as unknown as { pop: () => void }).pop()).toThrow()
    expect(() => {
      ;(models[0] as { name: string }).name = "mutated"
    }).toThrow()
  })

  test("replaces the complete visible state atomically", () => {
    const oldSnapshot = snapshot("old")
    const newSnapshot = replacementSnapshot()
    const registry = new CatalogRegistry(oldSnapshot)
    const oldProviders = registry.listProviders()
    const oldModels = registry.listModels("alpha")

    registry.replaceSnapshot(newSnapshot)

    expect(registry.listProviders().map((entry) => entry.id)).toEqual(["gamma"])
    expect(registry.listModels("alpha")).toEqual([])
    expect(registry.getModel("alpha", "alpha/z-model")).toBeNull()
    expect(registry.listModels("gamma").map((entry) => entry.name)).toEqual(["new model"])
    expect(registry.getModel("gamma", "gamma/new-model")?.name).toBe("new model")
    expect(oldProviders[0]?.models["alpha/z-model"]?.name).toBe("old z")
    expect(oldModels[0]?.name).toBe("old z")
  })
})
