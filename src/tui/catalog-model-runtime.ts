import {
  CatalogSnapshotStore,
  createCatalogSnapshot,
} from "../provider/catalog-snapshot"
import { CatalogRegistry } from "../provider/catalog-registry"
import { ActiveProviderSet, type ProviderAuthResolver } from "../provider/active-providers"
import {
  DefaultCredentialResolver,
  type ProviderAuthStatus,
} from "../provider/credentials"
import { createDefaultCredentialStore, type CredentialStore } from "../provider/credential-store"
import { loadOAuthTokenFile } from "../provider/oauth-token-files"
import { createRuntimeProviderRegistry } from "../provider/resolver"
import type { ProviderRegistry } from "../provider/registry"
import { bus } from "../session/events"

const EMPTY_CATALOG = createCatalogSnapshot({}, { fetchedAt: 0 })

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

  constructor(
    snapshotStore: CatalogSnapshotStore,
    catalog: CatalogRegistry,
    credentialStore: CredentialStore,
    providers: ProviderRegistry,
    activeProviders: ActiveProviderSet,
  ) {
    this.snapshotStore = snapshotStore
    this.catalog = catalog
    this.credentialStore = credentialStore
    this.providers = providers
    this.activeProviders = activeProviders
  }

  static async create(): Promise<CatalogModelRuntime> {
    const snapshotStore = new CatalogSnapshotStore()
    const snapshot = snapshotStore.loadCache()
    const catalog = new CatalogRegistry(snapshot ?? EMPTY_CATALOG)
    const credentialStore = await createDefaultCredentialStore()
    const providers = createRuntimeProviderRegistry()
    const activeProviders = new ActiveProviderSet(providers, createAuthResolver(credentialStore))
    return new CatalogModelRuntime(snapshotStore, catalog, credentialStore, providers, activeProviders)
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
    bus.emit("catalog-refreshed", {})
  }

  /** Publishes newly stored credentials to open model pickers without a catalog fetch. */
  async refreshAuthentication(): Promise<void> {
    await this.activeProviders.refresh()
    bus.emit("catalog-refreshed", {})
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
