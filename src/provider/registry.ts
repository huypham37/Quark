import type { LanguageModel } from "ai"
import type { CredentialSourceConfig, ResolvedCredential } from "./credentials"
import {
  BUNDLED_PROVIDER_DEFINITIONS,
  type ProviderDefinition,
  type ProviderRegistration,
} from "./definitions"

export interface ProviderAdapter {
  readonly definition: ProviderDefinition
  createLanguageModel(input: {
    modelId: string
    credential: ResolvedCredential | null
  }): Promise<LanguageModel>
}

export interface ProviderRuntime extends ProviderRegistration {
  adapter: ProviderAdapter
  source: "bundled" | "configured" | "plugin"
}

export type ProviderAdapterFactory = (definition: ProviderDefinition) => ProviderAdapter

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const RESERVED_PROVIDER_IDS = new Set(["compaction"])

export function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase()
}

export function validateProviderId(providerId: string): string {
  const normalized = normalizeProviderId(providerId)
  if (!PROVIDER_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid provider ID "${providerId}". Use lowercase letters, numbers, and hyphens.`)
  }
  if (RESERVED_PROVIDER_IDS.has(normalized)) {
    throw new Error(`Provider ID "${normalized}" is reserved.`)
  }
  return normalized
}

export class ProviderRegistry {
  private readonly runtimes = new Map<string, ProviderRuntime>()

  register(input: {
    definition: ProviderDefinition
    credentialSource?: CredentialSourceConfig
    adapter: ProviderAdapter
    source: ProviderRuntime["source"]
  }): ProviderRuntime {
    const id = validateProviderId(input.definition.id)
    if (input.adapter.definition.id !== input.definition.id) {
      throw new Error(`Provider adapter definition does not match "${input.definition.id}".`)
    }
    const existing = this.runtimes.get(id)
    if (existing) {
      throw new Error(
        `Provider ID "${id}" is already registered by ${existing.source} provider "${existing.definition.name}".`,
      )
    }
    const runtime: ProviderRuntime = {
      definition: { ...input.definition, id },
      credentialSource: input.credentialSource ?? { source: "auto" },
      adapter: input.adapter,
      source: input.source,
    }
    this.runtimes.set(id, runtime)
    return runtime
  }

  get(providerId: string): ProviderRuntime | null {
    return this.runtimes.get(normalizeProviderId(providerId)) ?? null
  }

  require(providerId: string): ProviderRuntime {
    const runtime = this.get(providerId)
    if (!runtime) throw new Error(`Unknown provider "${providerId}".`)
    return runtime
  }

  list(): ProviderRuntime[] {
    return [...this.runtimes.values()]
  }
}

export function createBundledProviderRegistry(
  createAdapter: ProviderAdapterFactory,
): ProviderRegistry {
  const registry = new ProviderRegistry()
  for (const definition of Object.values(BUNDLED_PROVIDER_DEFINITIONS)) {
    registry.register({
      definition,
      adapter: createAdapter(definition),
      credentialSource: { source: "auto" },
      source: "bundled",
    })
  }
  return registry
}
