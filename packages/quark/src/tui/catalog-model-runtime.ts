import {
  CatalogSnapshotStore,
  createCatalogSnapshot,
} from "@quark/runner/provider/catalog-snapshot"
import { CatalogRegistry } from "@quark/runner/provider/catalog-registry"
import { ActiveProviderSet, type ProviderAuthResolver } from "@quark/runner/provider/active-providers"
import {
  DefaultCredentialResolver,
  type ProviderAuthStatus,
} from "@quark/runner/provider/credentials"
import { createDefaultCredentialStore, type CredentialStore } from "@quark/runner/provider/credential-store"
import { loadOAuthTokenFile } from "@quark/runner/provider/oauth-token-files"
import { createRuntimeProviderRegistry } from "@quark/runner/provider/resolver"
import type { ProviderRegistry } from "@quark/runner/provider/registry"
import { bus as defaultBus, TypedBus } from "@quark/runner/session/events"

const EMPTY_CATALOG = createCatalogSnapshot({}, { fetchedAt: 0 })

export interface CatalogModelRuntimeOptions {
  snapshotStore?: CatalogSnapshotStore
  credentialStore?: CredentialStore
}

function createAuthResolver(store: CredentialStore): ProviderAuthResolver {
  const resolver = new DefaultCredentialResolver(
    store,
    undefined,
    process.env,
    loadOAuthTokenFile,
  )
  return {
    status(input): Promise<ProviderAuthStatus> {
      return resolver.status(input)
    },
  }
}

/** Runtime-owned catalog/activity state for the TUI model picker and cycler. */
export class CatalogModelRuntime {
  readonly snapshotStore: CatalogSnapshotStore
  readonly catalog: CatalogRegistry
  private readonly credentialStore: CredentialStore
  private providers: ProviderRegistry
  private activeProviders: ActiveProviderSet
  private cachedCatalogLoaded = false
  /** Bus `catalog-refreshed` is published on (the app's stable bus). */
  private readonly bus: TypedBus

  constructor(
    snapshotStore: CatalogSnapshotStore,
    catalog: CatalogRegistry,
    credentialStore: CredentialStore,
    providers: ProviderRegistry,
    activeProviders: ActiveProviderSet,
    bus: TypedBus = defaultBus,
  ) {
    this.snapshotStore = snapshotStore
    this.catalog = catalog
    this.credentialStore = credentialStore
    this.providers = providers
    this.activeProviders = activeProviders
    this.bus = bus
  }

  /** Creates empty catalog state without reading or indexing the disk cache. */
  static async create(
    bus: TypedBus = defaultBus,
    options: CatalogModelRuntimeOptions = {},
  ): Promise<CatalogModelRuntime> {
    const snapshotStore = options.snapshotStore ?? new CatalogSnapshotStore()
    const catalog = new CatalogRegistry(EMPTY_CATALOG)
    const credentialStore = options.credentialStore ?? await createDefaultCredentialStore()
    const providers = createRuntimeProviderRegistry()
    const activeProviders = new ActiveProviderSet(providers, createAuthResolver(credentialStore))
    return new CatalogModelRuntime(snapshotStore, catalog, credentialStore, providers, activeProviders, bus)
  }

  /**
   * Loads and publishes the local cache once, without fetching or refreshing auth.
   * Call after the first app frame, before refresh(). Missing/invalid cache data
   * is handled by the snapshot store and leaves the current catalog unchanged.
   */
  loadCachedCatalog(): void {
    if (this.cachedCatalogLoaded) return
    const snapshot = this.snapshotStore.loadCache()
    if (snapshot) this.catalog.replaceSnapshot(snapshot)
    this.cachedCatalogLoaded = true
    this.bus.emit("catalog-refreshed", {})
  }

  get active(): ActiveProviderSet {
    return this.activeProviders
  }

  /** Refreshes catalog and authentication state without publishing partial catalog data. */
  async refresh(): Promise<void> {
    const [snapshot] = await Promise.all([
      this.snapshotStore.refresh(),
      this.activeProviders.refresh(),
    ])
    if (snapshot) this.catalog.replaceSnapshot(snapshot)
    this.bus.emit("catalog-refreshed", {})
  }

  /** Publishes newly stored credentials to open model pickers without a catalog fetch. */
  async refreshAuthentication(): Promise<void> {
    await this.activeProviders.refresh()
    this.bus.emit("catalog-refreshed", {})
  }

  /** Rebuild provider ownership after config reload, then refresh auth activity. */
  reloadProviders(): void {
    this.providers = createRuntimeProviderRegistry()
    this.activeProviders = new ActiveProviderSet(
      this.providers,
      createAuthResolver(this.credentialStore),
    )
  }
}
