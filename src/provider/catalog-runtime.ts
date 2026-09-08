import type { CatalogModel } from "./catalog-snapshot"
import type { PriceRates, PricingDescriptor, ThinkingCapability } from "./catalog-types"

/** Convert the selected catalog record's cost fields for accounting. */
export function pricingFromCatalogModel(model: CatalogModel): PricingDescriptor {
  const cost = model.cost
  if (!cost) return { kind: "unknown" }

  const rates: PriceRates = {
    inputPerMillionUsd: cost.input,
    outputPerMillionUsd: cost.output,
    cacheReadPerMillionUsd: cost.cache_read,
    cacheWritePerMillionUsd: cost.cache_write,
  }
  return {
    kind: "metered",
    rates,
    source: "models.dev",
    asOf: Date.now(),
  }
}

/** Normalize catalog reasoning facts for runtime/profile validation. */
export function thinkingCapabilityFromCatalog(model: CatalogModel): ThinkingCapability | null {
  if (!model.reasoning) return null
  const options = model.reasoning_options ?? []
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    const levels = effort.values.filter((value): value is string => typeof value === "string")
    return { levels: levels.includes("none") ? levels : ["none", ...levels] }
  }

  if (options.some((option) => option.type === "toggle")) {
    return { levels: ["none", "thinking"] }
  }

  const budget = options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens") {
    return {
      levels: ["none", "thinking"],
      budget: { min: budget.min === -1 ? undefined : budget.min, max: budget.max },
    }
  }

  return { levels: ["none"] }
}
