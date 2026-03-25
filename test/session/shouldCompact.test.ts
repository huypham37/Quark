import { describe, it, expect } from "bun:test"
import { shouldCompact, estimateTokens } from "../../src/session/compaction"
import type { ModelMessage } from "ai"

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("estimates tokens from system + string content messages", () => {
    const system = "a".repeat(400) // 400 chars = 100 tokens
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(200) }, // 50 tokens
    ]
    const est = estimateTokens(system, messages)
    expect(est).toBe(150)
  })

  it("estimates tokens from array content (text + tool-call)", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "x".repeat(100) },
          { type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "/file.ts" } },
        ],
      },
    ]
    const est = estimateTokens("", messages)
    // 100 chars from text + JSON.stringify({path:"/file.ts"}) = ~20 chars
    expect(est).toBeGreaterThan(25)
    expect(est).toBeLessThan(40)
  })

  it("estimates tokens from tool-result output", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read",
            output: { type: "text", value: "z".repeat(800) },
          },
        ],
      },
    ]
    const est = estimateTokens("", messages)
    expect(est).toBe(200) // 800/4
  })
})

// ---------------------------------------------------------------------------
// shouldCompact
// ---------------------------------------------------------------------------

describe("shouldCompact", () => {
  it("returns false after compaction (small context)", () => {
    // After compaction, the model messages are just the anchor summary + recent turns
    const system = "You are an assistant."
    const messages: ModelMessage[] = [
      { role: "user", content: "Summary of prior work." },
      { role: "user", content: "Do the next step." },
      { role: "assistant", content: [{ type: "text", text: "Sure, done." }] },
    ]
    // With a 100k context window and 0.95 threshold, this tiny context should NOT trigger
    const result = shouldCompact(system, messages, { context: 100_000, output: 8_000 }, 100_000, 0.95)
    expect(result).toBe(false)
  })

  it("returns true when context exceeds threshold * context_window", () => {
    const system = "a".repeat(4000) // ~1000 tokens
    const bigMsg = "b".repeat(36000) // ~9000 tokens
    const messages: ModelMessage[] = [{ role: "user", content: bigMsg }]
    // Model limit: 10k context. threshold 0.95 → trigger at 9500.
    // estimated = ~10000 tokens → should trigger
    const result = shouldCompact(system, messages, { context: 10_000, output: 1_000 }, 100_000, 0.95)
    expect(result).toBe(true)
  })

  it("uses fallback context_window when no model limit", () => {
    const system = "a".repeat(400) // ~100 tokens
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3200) }, // ~800 tokens
    ]
    // fallback=1000, threshold=0.95 → trigger at 950 tokens.
    // estimated = 900 → should NOT trigger
    const result = shouldCompact(system, messages, null, 1000, 0.95)
    expect(result).toBe(false)
  })

  it("returns false below threshold", () => {
    const system = "hi"
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }]
    // Estimated ~2 tokens, fallback 100k → well below
    const result = shouldCompact(system, messages, null, 100_000, 0.95)
    expect(result).toBe(false)
  })

  it("triggers at lower threshold", () => {
    const system = "a".repeat(400) // ~100 tokens
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3200) }, // ~800 tokens
    ]
    // fallback=1000, threshold=0.5 → trigger at 500 tokens.
    // estimated = 900 → should trigger
    const result = shouldCompact(system, messages, null, 1000, 0.5)
    expect(result).toBe(true)
  })
})
