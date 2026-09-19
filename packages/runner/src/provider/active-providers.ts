import type { CatalogModel } from "./catalog-snapshot"
import { CatalogRegistry } from "./catalog-registry"
import type { ProviderAuthStatus, CredentialProviderDefinition, CredentialSourceConfig } from "./credentials"
import type { ProviderRegistry, ProviderRuntime } from "./registry"

export interface ProviderAuthResolver {
  status(input: {
    provider: CredentialProviderDefinition
    source: CredentialSourceConfig
  }): Promise<ProviderAuthStatus>
}

type ActiveState = Readonly<{
  providerIds: readonly string[]
  providerIdSet: ReadonlySet<string>
}>

const EMPTY_MODELS: readonly CatalogModel[] = Object.freeze([])
const EMPTY_MODEL_PAIRS: readonly CatalogModelPair[] = Object.freeze([])

export type CatalogModelPair = readonly [connectionId: string, catalogProviderId: string, model: CatalogModel]

function createState(providerIds: readonly string[]): ActiveState {
  const ids = Object.freeze([...providerIds])
  return Object.freeze({
    providerIds: ids,
    providerIdSet: new Set(ids),
  })
}

/** Runtime-only provider activity derived from the existing credential resolver. */
export class ActiveProviderSet {
  private state: ActiveState = createState([])
  private refreshInFlight: Promise<readonly string[]> | null = null

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly auth: ProviderAuthResolver,
  ) {}

  listProviderIds(): readonly string[] {
    return this.state.providerIds
  }

  has(providerId: string): boolean {
    return this.state.providerIdSet.has(providerId)
  }

  /** Lists catalog models exposed by authenticated provider connections. */
  listCatalogModels(catalog: CatalogRegistry): readonly CatalogModel[] {
    return Object.freeze(this.listCatalogModelPairs(catalog).map(([, , model]) => model))
  }

  /** Lists connection/catalog/model tuples without conflating their identities. */
  listCatalogModelPairs(catalog: CatalogRegistry): readonly CatalogModelPair[] {
    const state = this.state
    if (state.providerIds.length === 0) return EMPTY_MODEL_PAIRS

    const models: CatalogModelPair[] = []
    for (const connectionId of state.providerIds) {
      const runtime = this.providers.get(connectionId)
      if (!runtime) continue
      const catalogProviderId = runtime.definition.catalogProviderId
      for (const model of catalog.listModels(catalogProviderId)) {
        models.push([connectionId, catalogProviderId, model])
      }
    }
    return Object.freeze(models)
  }

  /** Publishes a complete active-ID set after every provider check finishes. */
  refresh(): Promise<readonly string[]> {
    if (this.refreshInFlight) return this.refreshInFlight

    const refresh = this.checkProvidersAndPublish()
    const inFlight = refresh.finally(() => {
      if (this.refreshInFlight === inFlight) this.refreshInFlight = null
    })
    this.refreshInFlight = inFlight
    return inFlight
  }

  private async checkProvidersAndPublish(): Promise<readonly string[]> {
    const runtimes = this.providers.list()
    const results = await Promise.all(runtimes.map(async (runtime) => {
      try {
        const status = await this.auth.status({
          provider: runtime.definition,
          source: runtime.credentialSource,
        })
        // `not-required` is deliberately excluded: the plan leaves local
        // reachability for no-auth providers unresolved, so it is not treated
        // as authentication success or provider activity here.
        return status.state === "authenticated" ? runtime.definition.id : null
      } catch {
        // An individual resolver failure must not prevent other providers from
        // being checked, and no credential or resolver error leaves this API.
        return null
      }
    }))

    const activeIds = results.filter((providerId): providerId is string => providerId !== null)
    const nextState = createState(activeIds)
    this.state = nextState
    return nextState.providerIds
  }
}

// Keep the runtime type visible to callers that provide custom auth checks.
export type { ProviderRuntime }
