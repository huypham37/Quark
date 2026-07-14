import type { LanguageModel } from "ai"
import {
  getProviderConfig,
  loadConfig,
  parseModelSpec,
  resolveApiKey,
  type ProviderConfig,
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
  type ResolvedCredential,
} from "./credentials"
import type { ProviderDefinition } from "./definitions"
import { ModelRegistry, parseModelRef, type ModelDescriptor, type ModelRef, type PricingDescriptor } from "./catalog"
import { loadLegacyProviderCredential } from "./legacy-credentials"
import { createBundledProviderRegistry, type ProviderRegistry, type ProviderRuntime } from "./registry"

export interface ResolvedModel {
  languageModel: LanguageModel
  ref: ModelRef
  provider: ProviderRuntime
  descriptor: ModelDescriptor
  pricingSnapshot: PricingDescriptor
  providerOptionsKey: string
}

export interface ResolveModelOptions {
  codexFetch?: FetchFn
  codexTokenStore?: CodexTokenStore
  refreshCodexToken?: typeof refreshCodexToken
  credentialStore?: CredentialStore
  registry?: ProviderRegistry
}

function createLegacyProviderDefinition(id: string, config: ProviderConfig): ProviderDefinition {
  return {
    id,
    name: id,
    protocol: "openai-compatible",
    defaultEndpoint: config.baseURL,
    auth: { type: "api-key", environmentVariables: [] },
    metadataProviderId: id,
    providerOptionsKey: id,
    billing: "unknown",
  }
}

function registerLegacyProvider(
  registry: ProviderRegistry,
  providerId: string,
  config: ProviderConfig,
): void {
  const definition = createLegacyProviderDefinition(providerId, config)
  registry.register({
    definition,
    adapter: createProviderAdapter(definition),
    credentialSource: { source: "none" },
    source: "configured",
  })
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
  for (const providerId of Object.keys(loadConfig().providers)) {
    const config = getProviderConfig(providerId)
    if (config && !registry.get(providerId)) registerLegacyProvider(registry, providerId, config)
  }
  return registry
}

async function resolveCredential(
  provider: CredentialProviderDefinition,
  options: ResolveModelOptions,
): Promise<ResolvedCredential | null> {
  if (provider.id === "codex" && options.codexTokenStore) {
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
  const spec = modelSpec ?? (kind === "main" ? cfg.main_model : cfg.small_model)
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
  let runtime = registry.get(providerId)
  if (!runtime) {
    const legacyConfig = getProviderConfig(providerId)
    if (legacyConfig) {
      registerLegacyProvider(registry, providerId, legacyConfig)
      runtime = registry.require(providerId)
    }
  }
  if (!runtime) {
    throw new Error(`Unknown provider "${providerId}".`)
  }

  let credential: ResolvedCredential | null
  if (runtime.source === "configured") {
    const custom = loadConfig().providers[providerId]
    if (custom) {
      const store = options.credentialStore ?? await createDefaultCredentialStore()
      credential = await new DefaultCredentialResolver(store, undefined, process.env).resolve({
        provider: runtime.definition,
        source: custom.credential,
        interactive: false,
      })
    } else {
      const config = getProviderConfig(providerId)!
      const value = resolveApiKey(config.apiKey)
      credential = value
        ? new RedactedResolvedCredential({ type: "api-key", value }, config.apiKey.startsWith("env:") ? "environment" : "session")
        : null
    }
  } else {
    credential = await resolveCredential(runtime.definition, options)
  }

  const ref = parseModelRef(`${runtime.definition.id}/${modelId}`)
  const descriptor = new ModelRegistry().resolve(ref, runtime.definition)
  const languageModel = await runtime.adapter.createLanguageModel({ modelId, credential })
  return {
    languageModel,
    ref,
    provider: runtime,
    descriptor,
    pricingSnapshot: structuredClone(descriptor.pricing),
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
