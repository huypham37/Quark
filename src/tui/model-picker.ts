import { ModelRegistry, parseModelRef } from "../provider/catalog"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../provider/definitions"

export function buildModelPickerOptions(modelSpecs: string[]) {
  const catalog = new ModelRegistry()
  return modelSpecs.map((id) => {
    const ref = parseModelRef(id)
    const definition = BUNDLED_PROVIDER_DEFINITIONS[ref.providerId as keyof typeof BUNDLED_PROVIDER_DEFINITIONS]
    if (!definition) return { id: ref.spec, name: ref.modelId, detail: `${ref.providerId} · metadata unknown` }
    const descriptor = catalog.resolve(ref, definition)
    const auth = definition.auth.type === "none"
      ? "no auth"
      : definition.auth.type === "api-key" ? "API key" : "OAuth"
    return {
      id: descriptor.spec,
      name: descriptor.name ?? descriptor.modelId,
      detail: `${definition.name} · ${auth} · ${definition.billing}`,
    }
  })
}
