import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSession } from "../../src/session/session"
import { addPart, createAssistantMessage, finishMessage } from "../../src/session/message"
import { buildAggregate, extractSessionDigest } from "../../src/commands/statistics"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "quark-stats-v2-"))
  setSessionStorageRoot(root)
  ensureStorageRoot()
})
afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(root, { recursive: true, force: true })
})

describe("statistics v2 ledger", () => {
  test("reads canonical steps only with exact identity and all token classes", () => {
    const session = createSession()
    const message = createAssistantMessage({
      sessionId: session.id,
      providerId: "openai",
      modelId: "openai/gpt-test",
    })
    addPart({
      sessionId: session.id,
      messageId: message.id,
      type: "step-finish",
      data: {
        reason: "stop",
        model: { providerId: "openrouter", modelId: "vendor/model", spec: "openrouter/vendor/model" },
        tokens: {
          input: 100, inputNoCache: 60, cacheRead: 30, cacheWrite: 10,
          output: 40, reasoning: 15,
        },
        charge: {
          kind: "estimated",
          usd: 0.25,
          pricing: { rates: {}, source: "models.dev", asOf: 1 },
        },
      },
    })
    // Message aggregate must not be counted as another ledger entry.
    finishMessage(message.id, "stop", {
      tokensIn: 100,
      tokensOut: 40,
      cost: 0.25,
      aggregate: {
        tokens: { input: 100, output: 40 },
        charge: { kind: "mixed", reportedUsd: 0, estimatedUsd: 0.25 },
      },
    }, session.id)

    const digest = extractSessionDigest(session.id)
    const stats = buildAggregate({ [session.id]: { digest } })

    expect(digest).toHaveLength(1)
    expect(digest[0]).toMatchObject({
      modelId: "openrouter/vendor/model",
      providerId: "openrouter",
      input: 100,
      inputNoCache: 60,
      cacheRead: 30,
      cacheWrite: 10,
      output: 40,
      reasoning: 15,
      estimatedUsd: 0.25,
      chargeKind: "estimated",
    })
    expect(stats.providerTotals.openrouter).toMatchObject({ input: 100, estimatedUsd: 0.25 })
    expect(stats.grandTotal).toMatchObject({
      input: 100,
      inputNoCache: 60,
      cacheRead: 30,
      cacheWrite: 10,
      output: 40,
      reasoning: 15,
      estimatedUsd: 0.25,
      messageCount: 1,
      charges: { estimated: 1 },
    })
  })

  test("keeps subscription, free, and unknown classifications distinct", () => {
    const digest = ["subscription", "free", "unknown"].map((chargeKind) => ({
      modelId: `test/${chargeKind}`,
      providerId: "test",
      date: "2026-07-13",
      input: 1, inputNoCache: 1, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0,
      reportedUsd: 0, estimatedUsd: 0, chargeKind,
    }))
    const stats = buildAggregate({ session: { digest } })
    expect(stats.grandTotal.charges).toEqual({ subscription: 1, free: 1, unknown: 1 })
  })
})
