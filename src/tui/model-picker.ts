import { CatalogRegistry } from "../provider/catalog-registry"
import { ActiveProviderSet } from "../provider/active-providers"
import type { PickerOption } from "./picker-items"

export type CatalogPickerOption = PickerOption

function modelSpec(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

function conciseDetail(providerName: string, description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim()
  return `${providerName} · ${normalized.slice(0, 160)}`
}

/** Build picker options from the exact catalog records exposed by active providers. */
export function buildModelPickerOptions(
  activeProviders: ActiveProviderSet,
  catalog: CatalogRegistry,
): CatalogPickerOption[] {
  const options: CatalogPickerOption[] = []
  const seen = new Set<string>()

  for (const [, catalogProviderId, model] of activeProviders.listCatalogModelPairs(catalog)) {
    const provider = catalog.getProvider(catalogProviderId)
    if (!provider) continue

    const id = modelSpec(catalogProviderId, model.id)
    if (seen.has(id)) continue
    seen.add(id)
    options.push({
      id,
      name: model.name,
      detail: conciseDetail(provider.name, model.description),
    })
  }

  return options
}
