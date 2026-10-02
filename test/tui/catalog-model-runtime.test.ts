import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { LanguageModel } from "ai"
import { ActiveProviderSet } from "../../packages/runner/src/provider/active-providers"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import {
  CatalogSnapshotStore,
  createCatalogSnapshot,
  writeCatalogSnapshotAtomic,
} from "../../packages/runner/src/provider/catalog-snapshot"
import type { CredentialStore } from "../../packages/runner/src/provider/credential-store"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../../packages/runner/src/provider/definitions"
import { ProviderRegistry, type ProviderAdapter } from "../../packages/runner/src/provider/registry"
import { bus, TypedBus } from "../../packages/runner/src/session/events"
import { CatalogModelRuntime } from "../../packages/quark/src/tui/catalog-model-runtime"
import { buildModelPickerOptions } from "../../packages/quark/src/tui/model-picker"
import { retainPaletteSelectionIndex } from "../../packages/quark/src/tui/palette-index"

const temporaryDirectories: string[] = []

afterEach(() => {
  bus.removeAllListeners("catalog-refreshed")
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.length = 0
})

function model(id: string, name = id) {
  return {
    id,
    name,
    description: `${name} description`,
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: "2025-01-01",
    last_updated: "2025-06-01",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 100_000, output: 4_000 },
  }
}

function snapshot(models: Record<string, ReturnType<typeof model>>, fetchedAt: number) {
  return createCatalogSnapshot({
    alpha: {
      id: "alpha",
      name: "Alpha Catalog",
      npm: "@alpha/ai",
      env: ["ALPHA_API_KEY"],
      doc: "https://alpha.example",
      models,
    },
  }, { fetchedAt })
}

function temporaryPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quark-runtime-"))
  temporaryDirectories.push(directory)
  return path.join(directory, "catalog.json")
}

class EmptyCredentialStore implements CredentialStore {
  async get(): Promise<null> { return null }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  async status(): Promise<"missing"> { return "missing" }
}

function createRuntime(
  initial: ReturnType<typeof snapshot>,
  fetchImpl: typeof fetch,
  isAuthenticated: () => boolean = () => true,
): CatalogModelRuntime {
  const cachePath = temporaryPath()
  writeCatalogSnapshotAtomic(cachePath, initial)
  const store = new CatalogSnapshotStore({ cachePath, fetch: fetchImpl })
  const cached = store.loadCache()
  if (!cached) throw new Error("test cache did not load")

  const definition: ProviderDefinition = {
    ...BUNDLED_PROVIDER_DEFINITIONS.openai,
    id: "alpha",
    catalogProviderId: "alpha",
    name: "Alpha",
    providerOptionsKey: "alpha",
  }
  const providers = new ProviderRegistry()
  const adapter: ProviderAdapter = {
    definition,
    async createLanguageModel() { return {} as LanguageModel },
  }
  providers.register({ definition, adapter })
  const active = new ActiveProviderSet(providers, {
    async status({ provider }) {
      return { providerId: provider.id, state: isAuthenticated() ? "authenticated" : "missing" }
    },
  })

  return new CatalogModelRuntime(
    store,
    new CatalogRegistry(cached),
    new EmptyCredentialStore(),
    providers,
    active,
  )
}

class CountingCatalogSnapshotStore extends CatalogSnapshotStore {
  loadCacheCalls = 0

  override loadCache() {
    this.loadCacheCalls++
    return super.loadCache()
  }
}

async function createEmptyRuntime(store: CatalogSnapshotStore, eventBus: TypedBus) {
  return CatalogModelRuntime.create(eventBus, {
    snapshotStore: store,
    credentialStore: new EmptyCredentialStore(),
  })
}

describe("CatalogModelRuntime deferred cache initialization", () => {
  test("creates empty state without loading an existing disk catalog", async () => {
    const cachePath = temporaryPath()
    writeCatalogSnapshotAtomic(cachePath, snapshot({ "alpha/cached": model("alpha/cached") }, 1))
    let fetchCalls = 0
    const store = new CountingCatalogSnapshotStore({
      cachePath,
      fetch: async () => { fetchCalls++; throw new Error("offline") },
    })
    const eventBus = new TypedBus()
    let publications = 0
    eventBus.on("catalog-refreshed", () => { publications++ })

    const runtime = await createEmptyRuntime(store, eventBus)

    expect(runtime.snapshotStore).toBe(store)
    expect(store.loadCacheCalls).toBe(0)
    expect(store.snapshot).toBeNull()
    expect(runtime.catalog.listProviders()).toEqual([])
    expect(runtime.catalog.listModels("alpha")).toEqual([])
    expect(runtime.active.listProviderIds()).toEqual([])
    expect(fetchCalls).toBe(0)
    expect(publications).toBe(0)
  })

  test("synchronously publishes an isolated immutable cache before an offline refresh", async () => {
    const cachePath = temporaryPath()
    writeCatalogSnapshotAtomic(cachePath, snapshot({ "alpha/cached": model("alpha/cached") }, 1))
    let fetchCalls = 0
    const store = new CountingCatalogSnapshotStore({
      cachePath,
      fetch: async () => { fetchCalls++; throw new Error("offline") },
    })
    const eventBus = new TypedBus()
    const runtime = await createEmptyRuntime(store, eventBus)
    const catalog = runtime.catalog
    const emptyProviders = catalog.listProviders()
    const published: string[][] = []
    eventBus.on("catalog-refreshed", () => {
      published.push(catalog.listModels("alpha").map((entry) => entry.id))
    })

    expect(runtime.loadCachedCatalog()).toBeUndefined()

    expect(store.loadCacheCalls).toBe(1)
    expect(fetchCalls).toBe(0)
    expect(published).toEqual([["alpha/cached"]])
    expect(runtime.catalog).toBe(catalog)
    expect(emptyProviders).toEqual([])
    expect(runtime.active.listProviderIds()).toEqual([])
    const cachedModel = store.snapshot!.catalog.alpha!.models["alpha/cached"]!
    const publishedModel = catalog.getModel("alpha", "alpha/cached")!
    expect(publishedModel).toEqual(cachedModel)
    expect(publishedModel).not.toBe(cachedModel)
    expect(publishedModel.limit).not.toBe(cachedModel.limit)
    expect(Object.isFrozen(catalog.listProviders())).toBe(true)
    expect(Object.isFrozen(catalog.listModels("alpha"))).toBe(true)
    expect(Object.isFrozen(publishedModel)).toBe(true)
    expect(Object.isFrozen(publishedModel.limit)).toBe(true)

    await runtime.refresh()

    expect(fetchCalls).toBe(1)
    expect(store.loadCacheCalls).toBe(1)
    expect(published).toEqual([["alpha/cached"], ["alpha/cached"]])
    expect(catalog.getModel("alpha", "alpha/cached")).toEqual(cachedModel)
  })

  test("initializes once, including reentrant calls, without republishing or replacing later state", async () => {
    const cachePath = temporaryPath()
    writeCatalogSnapshotAtomic(cachePath, snapshot({ "alpha/old": model("alpha/old") }, 1))
    const store = new CountingCatalogSnapshotStore({ cachePath })
    const eventBus = new TypedBus()
    const runtime = await createEmptyRuntime(store, eventBus)
    let publications = 0
    eventBus.on("catalog-refreshed", () => {
      publications++
      runtime.loadCachedCatalog()
    })

    runtime.loadCachedCatalog()
    const initializedModels = runtime.catalog.listModels("alpha")
    runtime.loadCachedCatalog()
    expect(runtime.catalog.listModels("alpha")).toBe(initializedModels)

    writeCatalogSnapshotAtomic(cachePath, snapshot({ "alpha/disk": model("alpha/disk") }, 2))
    runtime.catalog.replaceSnapshot(snapshot({ "alpha/new": model("alpha/new") }, 3))
    const updatedModels = runtime.catalog.listModels("alpha")
    runtime.loadCachedCatalog()

    expect(store.loadCacheCalls).toBe(1)
    expect(publications).toBe(1)
    expect(runtime.catalog.listModels("alpha")).toBe(updatedModels)
    expect(updatedModels.map((entry) => entry.id)).toEqual(["alpha/new"])
    expect(initializedModels.map((entry) => entry.id)).toEqual(["alpha/old"])
  })

  for (const cache of ["missing", "invalid JSON", "invalid snapshot"] as const) {
    test(`handles ${cache} cache without throwing or retrying initialization`, async () => {
      const cachePath = temporaryPath()
      if (cache !== "missing") fs.writeFileSync(cachePath, cache === "invalid JSON" ? "not json" : "{}")
      let fetchCalls = 0
      const store = new CountingCatalogSnapshotStore({
        cachePath,
        fetch: async () => { fetchCalls++; throw new Error("offline") },
      })
      const eventBus = new TypedBus()
      const runtime = await createEmptyRuntime(store, eventBus)
      let publications = 0
      eventBus.on("catalog-refreshed", () => { publications++ })

      expect(() => runtime.loadCachedCatalog()).not.toThrow()
      writeCatalogSnapshotAtomic(cachePath, snapshot({ "alpha/late": model("alpha/late") }, 1))
      runtime.loadCachedCatalog()

      expect(store.loadCacheCalls).toBe(1)
      expect(store.snapshot).toBeNull()
      expect(runtime.catalog.listProviders()).toEqual([])
      expect(fetchCalls).toBe(0)
      expect(publications).toBe(1)
    })
  }
})

describe("CatalogModelRuntime refresh lifecycle", () => {
  test("publishes models immediately after credentials are stored", async () => {
    let authenticated = false
    const runtime = createRuntime(
      snapshot({ "alpha/model": model("alpha/model") }, 1),
      async () => { throw new Error("catalog fetch must not run") },
      () => authenticated,
    )

    await runtime.refreshAuthentication()
    expect(buildModelPickerOptions(runtime.active, runtime.catalog)).toEqual([])

    authenticated = true
    const published: string[][] = []
    bus.on("catalog-refreshed", () => {
      published.push(buildModelPickerOptions(runtime.active, runtime.catalog).map((option) => option.id))
    })

    await runtime.refreshAuthentication()

    expect(published).toEqual([["alpha/alpha/model"]])
  })

  test("keeps cached picker options usable after an offline refresh", async () => {
    const runtime = createRuntime(
      snapshot({ "alpha/old": model("alpha/old", "Old model") }, 1),
      async () => { throw new Error("offline") },
    )

    await runtime.active.refresh()
    await runtime.refresh()

    expect(buildModelPickerOptions(runtime.active, runtime.catalog).map((option) => option.id)).toEqual(["alpha/alpha/old"])
  })

  test("publishes updated picker options after a successful refresh", async () => {
    const runtime = createRuntime(
      snapshot({ "alpha/old": model("alpha/old", "Old model") }, 1),
      async () => new Response(JSON.stringify({
        alpha: {
          id: "alpha",
          name: "Alpha Catalog",
          npm: "@alpha/ai",
          env: ["ALPHA_API_KEY"],
          doc: "https://alpha.example",
          models: { "alpha/new": model("alpha/new", "New model") },
        },
      })),
    )

    const published: string[][] = []
    bus.on("catalog-refreshed", () => {
      published.push(buildModelPickerOptions(runtime.active, runtime.catalog).map((option) => option.id))
    })

    await runtime.refresh()

    expect(published).toEqual([["alpha/alpha/new"]])
  })

  test("preserves current identity when present and leaves no selection when absent", async () => {
    const currentModel = "alpha/alpha/old"
    const runtime = createRuntime(
      snapshot({ "alpha/old": model("alpha/old", "Old model") }, 1),
      async () => new Response(JSON.stringify({
        alpha: {
          id: "alpha",
          name: "Alpha Catalog",
          npm: "@alpha/ai",
          env: ["ALPHA_API_KEY"],
          doc: "https://alpha.example",
          models: {
            "alpha/old": model("alpha/old", "Updated old model"),
            "alpha/new": model("alpha/new", "New model"),
          },
        },
      })),
    )

    await runtime.refresh()
    const retained = buildModelPickerOptions(runtime.active, runtime.catalog)
    expect(currentModel).toBe("alpha/alpha/old")
    expect(retainPaletteSelectionIndex(`model:${currentModel}`, retained.map((option) => ({
      key: `model:${option.id}`,
      type: "model" as const,
      id: option.id,
      label: option.name,
      detail: option.detail,
      searchText: [option.name, option.id, option.detail ?? ""],
      action: { type: "model" as const, modelId: option.id },
    })))).toBe(0)

    runtime.catalog.replaceSnapshot(snapshot({ "alpha/new": model("alpha/new", "New model") }, 3))
    const missing = buildModelPickerOptions(runtime.active, runtime.catalog)
    expect(currentModel).toBe("alpha/alpha/old")
    expect(retainPaletteSelectionIndex(`model:${currentModel}`, missing.map((option) => ({
      key: `model:${option.id}`,
      type: "model" as const,
      id: option.id,
      label: option.name,
      detail: option.detail,
      searchText: [option.name, option.id, option.detail ?? ""],
      action: { type: "model" as const, modelId: option.id },
    })))).toBe(-1)
  })
})
