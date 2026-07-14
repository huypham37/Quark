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
    auth: {
      type: "api-key",
      environmentVariables: config.apiKey.startsWith("env:") ? [config.apiKey.slice(4)] : [],
    },
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
  for (const [providerId, config] of Object.entries(loadConfig().providers)) {
    if (!registry.get(providerId)) {
      const definition: ProviderDefinition = {
        id: providerId,
        name: providerId,
        protocol: "openai-compatible",
        defaultEndpoint: config.base_url,
        auth: { type: "api-key", environmentVariables: config.api_key_env ? [config.api_key_env] : [] },
        metadataProviderId: providerId,
        providerOptionsKey: providerId,
        billing: config.billing,
      }
      registry.register({
        definition,
        adapter: createProviderAdapter(definition),
        credentialSource: config.api_key_env
          ? { source: "environment", variable: config.api_key_env }
          : config.legacyCredentialSource!,
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
  const spec = modelSpec ?? (kind === "small" ? cfg.small_model : undefined)
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
    const store = options.credentialStore ?? await createDefaultCredentialStore()
    credential = await new DefaultCredentialResolver(store, undefined, process.env).resolve({
      provider: runtime.definition,
      source: runtime.credentialSource,
      interactive: false,
    })
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
