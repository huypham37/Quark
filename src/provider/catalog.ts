import type { BillingMode, ProviderDefinition } from "./definitions"
import { getModelLimit, getModelsDevModel } from "./models"

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

const STANDARD_REASONING = ["none", "minimal", "low", "medium", "high", "xhigh"]
const EXTENDED_REASONING = ["none", "low", "medium", "high", "xhigh", "max"]
const BINARY_REASONING = ["none", "thinking"]

const THINKING_CAPABILITIES: Record<string, ThinkingCapability> = {
  "claude-opus-4-7": { levels: EXTENDED_REASONING },
  "claude-opus-4-6": { levels: EXTENDED_REASONING },
  "claude-sonnet-4-6": { levels: EXTENDED_REASONING },
  "gpt-5": { levels: STANDARD_REASONING },
  "gpt-5.5": { levels: STANDARD_REASONING },
  "gpt-5.5-pro": { levels: STANDARD_REASONING },
  "gpt-5.4": { levels: STANDARD_REASONING },
  "gpt-5.4-pro": { levels: STANDARD_REASONING },
  "gpt-5.2": { levels: STANDARD_REASONING },
  "gpt-5-mini": { levels: STANDARD_REASONING },
  "gpt-5-nano": { levels: STANDARD_REASONING },
  "o4-mini": { levels: STANDARD_REASONING },
  o3: { levels: STANDARD_REASONING },
  o1: { levels: STANDARD_REASONING },
  "gpt-5.6": { levels: EXTENDED_REASONING, modes: ["standard", "pro"], defaultMode: "standard" },
  "gpt-5.6-sol": { levels: EXTENDED_REASONING, modes: ["standard", "pro"], defaultMode: "standard" },
  "gpt-5.6-terra": { levels: EXTENDED_REASONING, modes: ["standard", "pro"], defaultMode: "standard" },
  "gpt-5.6-luna": { levels: EXTENDED_REASONING, modes: ["standard", "pro"], defaultMode: "standard" },
  "qwen-max": { levels: BINARY_REASONING },
  "qwen-plus": { levels: BINARY_REASONING },
  "qwen-turbo": { levels: BINARY_REASONING },
  "qwen3-max": { levels: BINARY_REASONING },
  "qwen3-plus": { levels: BINARY_REASONING },
  "qwen3.6-plus": { levels: BINARY_REASONING },
  "qwen3.6": { levels: BINARY_REASONING },
  "minimax-m2.7": { levels: BINARY_REASONING },
  "glm-5.1": { levels: BINARY_REASONING },
  "kimi-": { levels: BINARY_REASONING },
  "deepseek-": { levels: ["none", "high", "max"] },
}

export function getThinkingCapability(modelId: string): ThinkingCapability | null {
  const bareModel = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId
  const exact = THINKING_CAPABILITIES[bareModel]
  if (exact) return structuredClone(exact)
  for (const [prefix, capability] of Object.entries(THINKING_CAPABILITIES)) {
    if (bareModel.startsWith(prefix)) return structuredClone(capability)
  }
  return null
}

export interface ModelCapabilities {
  toolCall?: boolean
  attachment?: boolean
  reasoning?: ThinkingCapability
  structuredOutput?: boolean
  modalities?: { input: string[]; output: string[] }
}

export interface ModelDescriptor extends ModelRef {
  name?: string
  limits: ReturnType<typeof getModelLimit>
  capabilities: ModelCapabilities
  pricing: PricingDescriptor
  available: "configured" | "discovered" | "unknown"
}

export function parseModelRef(spec: string): ModelRef {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) {
    throw new Error(`Model spec "${spec}" must include non-empty provider and model segments.`)
  }
  const providerId = spec.slice(0, slash).toLowerCase()
  const modelId = spec.slice(slash + 1)
  return { providerId, modelId, spec: `${providerId}/${modelId}` }
}

function billingPricing(billing: BillingMode): PricingDescriptor | null {
  if (billing === "subscription") return { kind: "subscription" }
  if (billing === "free") return { kind: "free" }
  if (billing === "unknown") return { kind: "unknown" }
  return null
}

function finiteRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function modelsDevPricing(model: Record<string, unknown> | null): PricingDescriptor {
  const cost = model?.cost
  if (!cost || typeof cost !== "object") return { kind: "unknown" }
  const raw = cost as Record<string, unknown>
  const rates: PriceRates = {
    inputPerMillionUsd: finiteRate(raw.input),
    outputPerMillionUsd: finiteRate(raw.output),
    cacheReadPerMillionUsd: finiteRate(raw.cache_read ?? raw.cacheRead),
    cacheWritePerMillionUsd: finiteRate(raw.cache_write ?? raw.cacheWrite),
  }
  if (Object.values(rates).every((rate) => rate === undefined)) return { kind: "unknown" }
  return { kind: "metered", rates, source: "models.dev", asOf: Date.now() }
}

function modelsDevCapabilities(modelId: string, model: Record<string, unknown> | null): ModelCapabilities {
  const localReasoning = getThinkingCapability(modelId)
  if (!model) return localReasoning ? { reasoning: localReasoning } : {}
  const modalities = model.modalities
  return {
    toolCall: typeof model.tool_call === "boolean" ? model.tool_call : undefined,
    attachment: typeof model.attachment === "boolean" ? model.attachment : undefined,
    reasoning: localReasoning ?? (model.reasoning === true ? { levels: [] } : undefined),
    structuredOutput: typeof model.structured_output === "boolean" ? model.structured_output : undefined,
    modalities: modalities && typeof modalities === "object"
      ? {
          input: Array.isArray((modalities as any).input) ? (modalities as any).input : [],
          output: Array.isArray((modalities as any).output) ? (modalities as any).output : [],
        }
      : undefined,
  }
}

export class ModelRegistry {
  resolve(ref: ModelRef, provider: ProviderDefinition): ModelDescriptor {
    const metadata = getModelsDevModel(provider.metadataProviderId, ref.modelId)
    const override = billingPricing(provider.billing)
    return {
      ...ref,
      name: typeof metadata?.name === "string" ? metadata.name : undefined,
      limits: getModelLimit(ref.spec),
      capabilities: modelsDevCapabilities(ref.modelId, metadata),
      pricing: override ?? modelsDevPricing(metadata),
      available: metadata ? "configured" : "unknown",
    }
  }
}
