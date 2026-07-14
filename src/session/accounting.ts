import type { JSONObject } from "@ai-sdk/provider"
import type { LanguageModelUsage } from "ai"
import type { ModelRef, PriceRates, PricingDescriptor } from "../provider/catalog"

export interface TokenUsage {
  input?: number
  inputNoCache?: number
  output?: number
  outputText?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export type Charge =
  | { kind: "reported"; usd: number; source: string }
  | {
      kind: "estimated"
      usd: number
      pricing: { rates: PriceRates; source: string; asOf: number }
    }
  | { kind: "subscription" }
  | { kind: "free" }
  | { kind: "unknown"; reason?: string }

export interface UsageAggregate {
  tokens: TokenUsage
  charge: Charge | { kind: "mixed"; reportedUsd: number; estimatedUsd: number }
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function normalizeUsage(usage: LanguageModelUsage | undefined): {
  tokens: TokenUsage
  rawUsage?: JSONObject
} {
  if (!usage) return { tokens: {} }
  const input = finiteNonNegative(usage.inputTokens)
  const cacheRead = finiteNonNegative(usage.inputTokenDetails?.cacheReadTokens)
  const cacheWrite = finiteNonNegative(usage.inputTokenDetails?.cacheWriteTokens)
  const reportedNoCache = finiteNonNegative(usage.inputTokenDetails?.noCacheTokens)
  const inputNoCache = reportedNoCache ?? (input !== undefined
    ? Math.max(0, input - (cacheRead ?? 0) - (cacheWrite ?? 0))
    : undefined)
  return {
    tokens: {
      input,
      inputNoCache,
      output: finiteNonNegative(usage.outputTokens),
      outputText: finiteNonNegative(usage.outputTokenDetails?.textTokens),
      reasoning: finiteNonNegative(usage.outputTokenDetails?.reasoningTokens),
      cacheRead,
      cacheWrite,
      total: finiteNonNegative(usage.totalTokens),
    },
    ...(usage.raw ? { rawUsage: usage.raw } : {}),
  }
}

function usageClassCost(tokens: number | undefined, rate: number | undefined): number | null {
  if (tokens === undefined || tokens === 0) return 0
  if (!Number.isFinite(tokens) || tokens < 0 || rate === undefined || !Number.isFinite(rate) || rate < 0) return null
  return tokens * rate
}

export function calculateCharge(
  tokens: TokenUsage,
  pricing: PricingDescriptor,
  reported?: { usd: number; source: string },
): Charge {
  if (reported && Number.isFinite(reported.usd) && reported.usd >= 0) {
    return { kind: "reported", usd: reported.usd, source: reported.source }
  }
  if (pricing.kind === "subscription") return { kind: "subscription" }
  if (pricing.kind === "free") return { kind: "free" }
  if (pricing.kind === "unknown") return { kind: "unknown", reason: "pricing unavailable" }

  const pieces = [
    usageClassCost(tokens.inputNoCache, pricing.rates.inputPerMillionUsd),
    usageClassCost(tokens.cacheRead, pricing.rates.cacheReadPerMillionUsd),
    usageClassCost(tokens.cacheWrite, pricing.rates.cacheWritePerMillionUsd),
    usageClassCost(tokens.output, pricing.rates.outputPerMillionUsd),
  ]
  if (pieces.some((piece) => piece === null)) {
    return { kind: "unknown", reason: "missing rate for non-zero token class" }
  }
  const usd = pieces.reduce<number>((total, piece) => total + (piece ?? 0), 0) / 1_000_000
  return {
    kind: "estimated",
    usd,
    pricing: { rates: { ...pricing.rates }, source: pricing.source, asOf: pricing.asOf },
  }
}

export function addTokenUsage(target: TokenUsage, usage: TokenUsage): void {
  for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
    const value = usage[key]
    if (value !== undefined) target[key] = (target[key] ?? 0) + value
  }
}

export function aggregateCharges(charges: Charge[]): UsageAggregate["charge"] {
  let reportedUsd = 0
  let estimatedUsd = 0
  const classifications = new Set<Charge["kind"]>()
  for (const charge of charges) {
    classifications.add(charge.kind)
    if (charge.kind === "reported") reportedUsd += charge.usd
    if (charge.kind === "estimated") estimatedUsd += charge.usd
  }
  if (classifications.size === 1) {
    const kind = [...classifications][0]
    if (kind === "reported") return { kind, usd: reportedUsd, source: "aggregate" }
    if (kind === "estimated") {
      return { kind: "mixed", reportedUsd: 0, estimatedUsd }
    }
    if (kind === "subscription") return { kind }
    if (kind === "free") return { kind }
    return { kind: "unknown" }
  }
  return { kind: "mixed", reportedUsd, estimatedUsd }
}

export function numericAggregateCost(charge: UsageAggregate["charge"]): number | undefined {
  if (charge.kind === "reported" || charge.kind === "estimated") return charge.usd
  if (charge.kind === "mixed" && charge.reportedUsd === 0) return charge.estimatedUsd
  if (charge.kind === "mixed" && charge.estimatedUsd === 0) return charge.reportedUsd
  return undefined
}

export interface AccountingStep {
  model: ModelRef
  tokens: TokenUsage
  rawUsage?: JSONObject
  pricingSnapshot: PricingDescriptor
  charge: Charge
}
