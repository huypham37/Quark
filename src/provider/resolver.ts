import type { LanguageModel } from "ai"
import {
  loadConfig,
  parseModelSpec,
  providerCredentialSource,
} from "../config/config"
import { fireHook } from "../plugin/registry"
import { createProviderAdapter } from "./adapters"
import {
  CodexTokenStore,
  refreshToken as refreshCodexToken,
  type FetchFn,
} from "./codex-auth"
import { createDefaultCredentialStore, type CredentialStore } from "./credential-store"
import {
  DefaultCredentialResolver,
  RedactedResolvedCredential,
  type CredentialProviderDefinition,
  type CredentialSourceConfig,
  type ResolvedCredential,
} from "./credentials"
import type { ProviderDefinition } from "./definitions"
import { parseModelRef, type ModelRef, type PricingDescriptor } from "./catalog-types"
import { CatalogRegistry } from "./catalog-registry"
import { CatalogSnapshotStore, createCatalogSnapshot, type CatalogModel } from "./catalog-snapshot"
import { pricingFromCatalogModel } from "./catalog-runtime"
import { loadLegacyProviderCredential } from "./legacy-credentials"
import { createBundledProviderRegistry, type ProviderRegistry, type ProviderRuntime } from "./registry"

export interface ResolvedModel {
  languageModel: LanguageModel
  ref: ModelRef
  provider: ProviderRuntime
  catalogModel: CatalogModel
  pricingSnapshot: PricingDescriptor
  providerOptionsKey: string
}

export interface ResolveModelOptions {
  codexFetch?: FetchFn
  codexTokenStore?: CodexTokenStore
  refreshCodexToken?: typeof refreshCodexToken
  credentialStore?: CredentialStore
  registry?: ProviderRegistry
  catalog?: CatalogRegistry
}

const EMPTY_CATALOG = createCatalogSnapshot({}, { fetchedAt: 0 })
let defaultCatalog: CatalogRegistry | undefined

function getDefaultCatalog(): CatalogRegistry {
  if (defaultCatalog) return defaultCatalog
  const store = new CatalogSnapshotStore()
  defaultCatalog = new CatalogRegistry(store.loadCache() ?? EMPTY_CATALOG)
  return defaultCatalog
}

export function createRuntimeProviderRegistry(options: ResolveModelOptions = {}): ProviderRegistry {
  return buildRegistry(options)
}

function buildRegistry(options: ResolveModelOptions): ProviderRegistry {
  if (options.registry) return options.registry
  const registry = createBundledProviderRegistry((definition) => createProviderAdapter(definition, {
    codexFetch: options.codexFetch,
    refreshCodexToken: options.refreshCodexToken,
    credentialStore: options.credentialStore,
    onCodexRefresh: options.codexTokenStore
      ? (token) => options.codexTokenStore!.save(token)
      : undefined,
  }))
  for (const [providerId, config] of Object.entries(loadConfig().providers)) {
    // Config rejects IDs that collide with a bundled provider, so the only
    // entries skipped here are tolerated legacy duplicates (the bundled
    // definition wins).
    if (!registry.get(providerId)) {
      const definition: ProviderDefinition = {
        id: providerId,
        catalogProviderId: providerId,
        name: providerId,
        protocol: "openai-compatible",
        defaultEndpoint: config.base_url,
        auth: {
          type: "api-key",
          environmentVariables: config.api_key?.startsWith("env:") ? [config.api_key.slice(4)] : [],
        },
        providerOptionsKey: providerId,
        billing: "unknown",
      }
      registry.register({
        definition,
        adapter: createProviderAdapter(definition),
        credentialSource: providerCredentialSource(config),
        source: "configured",
      })
    }
  }
  return registry
}

async function resolveCredential(
  provider: CredentialProviderDefinition,
  options: ResolveModelOptions,
): Promise<ResolvedCredential | null> {
  if (provider.id === "openai-codex" && options.codexTokenStore) {
    const token = options.codexTokenStore.load()
    return token
      ? new RedactedResolvedCredential({
          type: "oauth",
          access: token.access,
          refresh: token.refresh,
          expiresAt: token.expires,
          metadata: { accountId: token.accountId },
        }, "legacy-token-file")
      : null
  }

  const store = options.credentialStore ?? await createDefaultCredentialStore()
  return new DefaultCredentialResolver(
    store,
    undefined,
    process.env,
    loadLegacyProviderCredential,
  ).resolve({ provider, source: { source: "auto" }, interactive: false })
}

export async function resolveModelRuntime(
  modelSpec?: string,
  kind: "main" | "small" = "main",
  options: ResolveModelOptions = {},
): Promise<ResolvedModel> {
  const cfg = loadConfig()
  const spec = modelSpec ?? (kind === "small" ? cfg.modelConfig.small : undefined)
  if (!spec) {
    throw new Error(
      "No model specified. Set a model via --model, agent profile, or /model command.",
    )
  }
  const parsed = parseModelSpec(spec)
  if (!parsed.provider || !parsed.model) {
    throw new Error(
      `Model spec "${spec}" must include a provider prefix (e.g. "copilot/gpt-4o").`,
    )
  }

  const beforeOutput = await fireHook(
    "provider.request.before",
    { provider: parsed.provider, model: parsed.model, messages: [] },
    { provider: parsed.provider, model: parsed.model },
  )
  const providerId = beforeOutput.provider
  const modelId = beforeOutput.model
  if (!providerId || !modelId) {
    throw new Error("provider.request.before must return a complete provider/model specification.")
  }

  const registry = buildRegistry(options)
  const directRuntime = registry.get(providerId)

  const candidates = directRuntime
    ? [directRuntime, ...registry.list().filter((candidate) =>
        candidate.definition.id !== directRuntime.definition.id
        && candidate.definition.catalogProviderId === directRuntime.definition.catalogProviderId)]
    : registry.list().filter((candidate) => candidate.definition.catalogProviderId === providerId)
  if (candidates.length === 0) throw new Error(`Unknown provider "${providerId}".`)

  let runtime = candidates[0]!
  let credential: ResolvedCredential | null = null
  for (const candidate of candidates) {
    const resolved = candidate.source === "configured"
      ? await new DefaultCredentialResolver(
          options.credentialStore ?? await createDefaultCredentialStore(),
          undefined,
          process.env,
        ).resolve({
          provider: candidate.definition,
          source: candidate.credentialSource,
          interactive: false,
        })
      : await resolveCredential(candidate.definition, options)
    const compatible = candidate.definition.auth.type === "none"
      || (candidate.definition.auth.type === "api-key" && resolved?.credential.type === "api-key")
      || (candidate.definition.auth.type === "oauth-device" && resolved?.credential.type === "oauth")
    if (compatible) {
      runtime = candidate
      credential = resolved
      break
    }
  }

  const ref = parseModelRef(`${runtime.definition.catalogProviderId}/${modelId}`)
  const catalog = options.catalog ?? getDefaultCatalog()
  const catalogModel = catalog.getModel(runtime.definition.catalogProviderId, ref.modelId)
  if (!catalogModel) {
    throw new Error(`Model "${ref.spec}" is not present in the exact catalog.`)
  }
  const languageModel = await runtime.adapter.createLanguageModel({ modelId, credential })
  return {
    languageModel,
    ref,
    provider: runtime,
    catalogModel,
    pricingSnapshot: pricingFromCatalogModel(catalogModel),
    providerOptionsKey: runtime.definition.providerOptionsKey,
  }
}

/** Compatibility wrapper for callers that still consume only the AI SDK model. */
export async function resolveModel(
  modelSpec?: string,
  kind: "main" | "small" = "main",
  options: ResolveModelOptions = {},
): Promise<LanguageModel> {
  return (await resolveModelRuntime(modelSpec, kind, options)).languageModel
}
