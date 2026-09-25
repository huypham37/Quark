export interface ModelRef {
  providerId: string
  modelId: string
  spec: string
}

export interface PriceRates {
  inputPerMillionUsd?: number
  outputPerMillionUsd?: number
  cacheReadPerMillionUsd?: number
  cacheWritePerMillionUsd?: number
}

export interface ThinkingCapability {
  levels: string[]
  modes?: string[]
  defaultMode?: string
  budget?: { min?: number; max?: number }
}

export type PricingDescriptor =
  | { kind: "metered"; rates: PriceRates; source: "models.dev" | "provider"; asOf: number }
  | { kind: "subscription" }
  | { kind: "free" }
  | { kind: "unknown" }

export function parseModelRef(spec: string): ModelRef {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) {
    throw new Error(`Model spec "${spec}" must include non-empty provider and model segments.`)
  }
  const providerId = spec.slice(0, slash).toLowerCase()
  const modelId = spec.slice(slash + 1)
  return { providerId, modelId, spec: `${providerId}/${modelId}` }
}
