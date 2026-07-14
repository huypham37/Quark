import { describe, expect, test } from "bun:test"
import {
  addTokenUsage,
  aggregateCharges,
  calculateCharge,
  normalizeUsage,
  numericAggregateCost,
} from "../../src/session/accounting"

describe("usage accounting", () => {
  test("normalizes every AI SDK token class and raw usage", () => {
    const result = normalizeUsage({
      inputTokens: 100,
      inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 20, cacheWriteTokens: 10 },
      outputTokens: 40,
      outputTokenDetails: { textTokens: 25, reasoningTokens: 15 },
      totalTokens: 140,
      raw: { provider_field: 1 },
    })
    expect(result.tokens).toEqual({
      input: 100, inputNoCache: 70, cacheRead: 20, cacheWrite: 10,
      output: 40, outputText: 25, reasoning: 15, total: 140,
    })
    expect(result.rawUsage).toEqual({ provider_field: 1 })
  })

  test("estimates uncached, cache, and output without double-counting reasoning", () => {
    const charge = calculateCharge(
      { inputNoCache: 1_000_000, cacheRead: 500_000, cacheWrite: 250_000, output: 2_000_000, reasoning: 500_000 },
      {
        kind: "metered",
        rates: { inputPerMillionUsd: 1, cacheReadPerMillionUsd: 0.5, cacheWritePerMillionUsd: 2, outputPerMillionUsd: 3 },
        source: "models.dev",
        asOf: 123,
      },
    )
    expect(charge).toMatchObject({ kind: "estimated", usd: 7.75 })
  })

  test("requires rates only for non-zero classes", () => {
    expect(calculateCharge(
      { inputNoCache: 10, cacheRead: 1, output: 0 },
      { kind: "metered", rates: { inputPerMillionUsd: 1 }, source: "models.dev", asOf: 1 },
    )).toMatchObject({ kind: "unknown" })
    expect(calculateCharge(
      { inputNoCache: 10, cacheRead: 0, output: 0 },
      { kind: "metered", rates: { inputPerMillionUsd: 1 }, source: "models.dev", asOf: 1 },
    )).toMatchObject({ kind: "estimated", usd: 0.00001 })
  })

  test("keeps subscription, free, unknown, and reported distinct", () => {
    expect(calculateCharge({}, { kind: "subscription" })).toEqual({ kind: "subscription" })
    expect(calculateCharge({}, { kind: "free" })).toEqual({ kind: "free" })
    expect(calculateCharge({}, { kind: "unknown" })).toMatchObject({ kind: "unknown" })
    expect(calculateCharge({}, { kind: "subscription" }, { usd: 1.25, source: "provider" }))
      .toEqual({ kind: "reported", usd: 1.25, source: "provider" })
  })

  test("aggregates tokens and numeric charge compatibility", () => {
    const tokens = {}
    addTokenUsage(tokens, { input: 10, output: 2 })
    addTokenUsage(tokens, { input: 5, cacheRead: 3, output: 4 })
    expect(tokens).toEqual({ input: 15, cacheRead: 3, output: 6 })
    const charge = aggregateCharges([
      { kind: "estimated", usd: 1, pricing: { rates: {}, source: "x", asOf: 1 } },
      { kind: "estimated", usd: 2, pricing: { rates: {}, source: "x", asOf: 1 } },
    ])
    expect(charge).toEqual({ kind: "mixed", reportedUsd: 0, estimatedUsd: 3 })
    expect(numericAggregateCost(charge)).toBe(3)
  })
})
