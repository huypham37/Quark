import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { LanguageModel } from "ai"
import { ActiveProviderSet } from "../../src/provider/active-providers"
import { CatalogRegistry } from "../../src/provider/catalog-registry"
import {
  CatalogSnapshotStore,
  createCatalogSnapshot,
  writeCatalogSnapshotAtomic,
} from "../../src/provider/catalog-snapshot"
import type { CredentialStore } from "../../src/provider/credential-store"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../../src/provider/definitions"
import { ProviderRegistry, type ProviderAdapter } from "../../src/provider/registry"
import { bus } from "../../src/session/events"
import { CatalogModelRuntime } from "../../src/tui/catalog-model-runtime"
import { buildModelPickerOptions } from "../../src/tui/model-picker"
import { retainPaletteSelectionIndex } from "../../src/tui/palette-index"

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
