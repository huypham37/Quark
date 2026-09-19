import { describe, expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import { DefaultCredentialResolver, type Credential, type ProviderAuthStatus } from "../../packages/runner/src/provider/credentials"
import type { CredentialStore } from "../../packages/runner/src/provider/credential-store"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../../packages/runner/src/provider/definitions"
import { ActiveProviderSet } from "../../packages/runner/src/provider/active-providers"
import { ProviderRegistry, type ProviderAdapter } from "../../packages/runner/src/provider/registry"

class MemoryStore implements CredentialStore {
  readonly values = new Map<string, Credential>()

  async get(providerId: string): Promise<Credential | null> {
    return this.values.get(providerId) ?? null
  }
  async set(providerId: string, credential: Credential): Promise<void> {
    this.values.set(providerId, credential)
  }
  async delete(providerId: string): Promise<void> {
    this.values.delete(providerId)
  }
  async status(providerId: string): Promise<"present" | "missing"> {
    return this.values.has(providerId) ? "present" : "missing"
  }
}

function adapter(definition: ProviderDefinition): ProviderAdapter {
  return {
    definition,
    async createLanguageModel() {
      return {} as LanguageModel
    },
  }
}

function registry(...definitions: ProviderDefinition[]): ProviderRegistry {
  const result = new ProviderRegistry()
  for (const definition of definitions) {
    result.register({ definition, adapter: adapter(definition), source: "bundled" })
  }
  return result
}

function model(id: string) {
  return {
    id,
    name: id,
    description: `${id} description`,
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

function catalog(): CatalogRegistry {
  return new CatalogRegistry(createCatalogSnapshot({
    alpha: {
      id: "alpha",
      name: "Alpha",
      npm: "@alpha/ai",
      env: ["ALPHA_API_KEY"],
      doc: "https://alpha.example/docs",
      models: { "alpha/model": model("alpha/model") },
    },
    "metadata-alpha": {
      id: "metadata-alpha",
      name: "Metadata Alpha",
      npm: "@metadata-alpha/ai",
      env: ["METADATA_ALPHA_API_KEY"],
      doc: "https://metadata-alpha.example/docs",
      models: { "metadata-alpha/model": model("metadata-alpha/model") },
    },
    orphan: {
      id: "orphan",
      name: "Orphan",
      npm: "@orphan/ai",
      env: ["ORPHAN_API_KEY"],
      doc: "https://orphan.example/docs",
      models: { "orphan/model": model("orphan/model") },
    },
  }))
}

const alpha: ProviderDefinition = {
  ...BUNDLED_PROVIDER_DEFINITIONS.openai,
  id: "alpha",
  catalogProviderId: "alpha",
  name: "Alpha",
  providerOptionsKey: "alpha",
}
const beta: ProviderDefinition = {
  ...BUNDLED_PROVIDER_DEFINITIONS.anthropic,
  id: "beta",
  catalogProviderId: "beta",
  name: "Beta",
  providerOptionsKey: "beta",
}

function status(providerId: string, state: ProviderAuthStatus["state"]): ProviderAuthStatus {
  return { providerId, state }
}

describe("ActiveProviderSet", () => {
  test("includes authenticated connections and lists models from their declared catalog providers", async () => {
    const store = new MemoryStore()
    await store.set("alpha", { type: "api-key", value: "alpha-secret" })
    await store.set("beta", { type: "api-key", value: "beta-secret" })
    const resolver = new DefaultCredentialResolver(store, undefined, {})
    const active = new ActiveProviderSet(registry(alpha, beta), resolver)

    await active.refresh()

    expect(active.listProviderIds()).toEqual(["alpha", "beta"])
    expect(active.has("alpha")).toBe(true)
    expect(active.has("Alpha")).toBe(false)
    // beta is active but absent from the exact catalog, and catalog-only orphan
    // is not included.
    expect(active.listCatalogModels(catalog()).map((entry) => entry.id)).toEqual(["alpha/model"])
  })

  test("supports a connection ID that differs from its catalog provider ID", async () => {
    const connection: ProviderDefinition = {
      ...BUNDLED_PROVIDER_DEFINITIONS["openai-codex"],
      id: "alpha-connection",
      catalogProviderId: "alpha",
    }
    const active = new ActiveProviderSet(registry(connection), {
      async status({ provider }) {
        return status(provider.id, "authenticated")
      },
    })

    await active.refresh()

    expect(active.listProviderIds()).toEqual(["alpha-connection"])
    expect(active.listCatalogModelPairs(catalog()).map(([connectionId, catalogProviderId, entry]) => [
      connectionId,
      catalogProviderId,
      entry.id,
    ])).toEqual([["alpha-connection", "alpha", "alpha/model"]])
  })

  test("excludes missing and failed credentials without aborting other providers", async () => {
    const store = new MemoryStore()
    await store.set("alpha", { type: "api-key", value: "alpha-secret" })
    const failingStore: CredentialStore = {
      ...store,
      async get(providerId: string) {
        if (providerId === "beta") throw new Error("secret backend failure")
        return store.get(providerId)
      },
    }
    const resolver = new DefaultCredentialResolver(failingStore, undefined, {})
    const active = new ActiveProviderSet(registry(alpha, beta), resolver)

    await active.refresh()

    expect(active.listProviderIds()).toEqual(["alpha"])
  })

  test("does not treat no-auth providers as active", async () => {
    const local = BUNDLED_PROVIDER_DEFINITIONS.ollama
    const active = new ActiveProviderSet(
      registry(local),
      new DefaultCredentialResolver(new MemoryStore(), undefined, {}),
    )

    await active.refresh()

    // No-auth means authentication is not required, not that local reachability
    // succeeded. Reachability semantics remain intentionally unresolved.
    expect(active.listProviderIds()).toEqual([])
  })

  test("publishes a complete replacement atomically and coalesces concurrent refreshes", async () => {
    let current: ProviderAuthStatus["state"] = "authenticated"
    let release: (() => void) | undefined
    let waiting = false
    const gate = new Promise<void>((resolve) => { release = resolve })
    const auth = {
      async status({ provider }: { provider: ProviderDefinition }) {
        if (waiting) await gate
        return status(provider.id, current)
      },
    }
    const active = new ActiveProviderSet(registry(alpha), auth)
    await active.refresh()
    expect(active.listProviderIds()).toEqual(["alpha"])

    current = "missing"
    waiting = true
    const first = active.refresh()
    const second = active.refresh()
    expect(first).toBe(second)
    expect(active.listProviderIds()).toEqual(["alpha"])

    release!()
    await first
    expect(active.listProviderIds()).toEqual([])
  })

  test("keeps activity in memory only", async () => {
    const active = new ActiveProviderSet(registry(alpha), {
      async status({ provider }) {
        return status(provider.id, "authenticated")
      },
    })

    await active.refresh()
    const replacement = new ActiveProviderSet(registry(alpha), {
      async status({ provider }) {
        return status(provider.id, "missing")
      },
    })

    expect(replacement.listProviderIds()).toEqual([])
    expect(active.listProviderIds()).toEqual(["alpha"])
  })
})
