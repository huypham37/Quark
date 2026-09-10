import type {
  CatalogModel,
  CatalogProvider,
  CatalogSnapshot,
  ModelsDevCatalog,
} from "./catalog-snapshot"

const EMPTY_MODELS: readonly CatalogModel[] = Object.freeze([])

type RegistryState = Readonly<{
  providers: readonly CatalogProvider[]
  providersById: ReadonlyMap<string, CatalogProvider>
  modelsByProviderId: ReadonlyMap<string, ReadonlyMap<string, CatalogModel>>
  modelsByProvider: ReadonlyMap<string, readonly CatalogModel[]>
}>

function isCatalogSnapshot(input: CatalogSnapshot | ModelsDevCatalog): input is CatalogSnapshot {
  const candidate = input as Record<string, unknown>
  return candidate.version === 1 &&
    typeof candidate.source === "string" &&
    (typeof candidate.fetchedAt === "number" || typeof candidate.fetchedAt === "string") &&
    candidate.catalog !== null &&
    typeof candidate.catalog === "object"
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

function buildState(catalog: ModelsDevCatalog): RegistryState {
  // Parsed task-2 catalogs are already frozen; clone here as well so the
  // registry remains isolated when given a validated catalog object directly.
  const isolatedCatalog = freeze(structuredClone(catalog))
  const providers: CatalogProvider[] = []
  const providersById = new Map<string, CatalogProvider>()
  const modelsByProviderId = new Map<string, ReadonlyMap<string, CatalogModel>>()
  const modelsByProvider = new Map<string, readonly CatalogModel[]>()

  for (const [providerId, provider] of Object.entries(isolatedCatalog)) {
    const models: CatalogModel[] = []
    const providerModels = new Map<string, CatalogModel>()

    for (const [modelId, model] of Object.entries(provider.models)) {
      providerModels.set(modelId, model)
      models.push(model)
    }

    const orderedModels = Object.freeze(models)
    providers.push(provider)
    providersById.set(providerId, provider)
    modelsByProviderId.set(providerId, providerModels)
    modelsByProvider.set(providerId, orderedModels)
  }

  return Object.freeze({
    providers: Object.freeze(providers),
    providersById,
    modelsByProviderId,
    modelsByProvider,
  })
}

/** An immutable, exact-ID view over one validated models.dev catalog. */
export class CatalogRegistry {
  private state: RegistryState

  constructor(input: CatalogSnapshot | ModelsDevCatalog) {
    this.state = buildState(isCatalogSnapshot(input) ? input.catalog : input)
  }

  /** Atomically publishes a complete state built from the supplied snapshot. */
  replaceSnapshot(snapshot: CatalogSnapshot): void {
    const nextState = buildState(snapshot.catalog)
    this.state = nextState
  }

  /** Atomically publishes a complete state built from the supplied catalog. */
  replaceCatalog(catalog: ModelsDevCatalog): void {
    const nextState = buildState(catalog)
    this.state = nextState
  }

  getProvider(providerId: string): CatalogProvider | null {
    return this.state.providersById.get(providerId) ?? null
  }

  listProviders(): readonly CatalogProvider[] {
    return this.state.providers
  }

  getModel(providerId: string, modelId: string): CatalogModel | null {
    return this.state.modelsByProviderId.get(providerId)?.get(modelId) ?? null
  }

  listModels(providerId: string): readonly CatalogModel[] {
    return this.state.modelsByProvider.get(providerId) ?? EMPTY_MODELS
  }
}
