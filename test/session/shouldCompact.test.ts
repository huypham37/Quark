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

// ---------------------------------------------------------------------------
// shouldCompact — 50% default threshold (issue #69)
// ---------------------------------------------------------------------------

describe("shouldCompact — 50% default threshold", () => {
  it("returns true when context usage exceeds 50% of context window", () => {
    // system: 400 chars = 100 tokens, message: 2400 chars = 600 tokens → 700 total
    // fallback=1000, threshold=0.50 → trigger at 500 tokens.
    // 700 >= 500 → should trigger
    const system = "a".repeat(400)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(2400) },
    ]
    const result = shouldCompact(system, messages, null, 1000, 0.50)
    expect(result).toBe(true)
  })

  it("returns false when context usage is below 50% of context window", () => {
    // system: 400 chars = 100 tokens, message: 800 chars = 200 tokens → 300 total
    // fallback=1000, threshold=0.50 → trigger at 500 tokens.
    // 300 < 500 → should NOT trigger
    const system = "a".repeat(400)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(800) },
    ]
    const result = shouldCompact(system, messages, null, 1000, 0.50)
    expect(result).toBe(false)
  })

  it("returns true at exactly the 50% boundary (estimated === threshold * window)", () => {
    // We need exactly 500 tokens → 2000 chars total.
    // system: 400 chars = 100 tokens, message: 1600 chars = 400 tokens → 500 total.
    // fallback=1000, threshold=0.50 → trigger at 500 tokens.
    // 500 >= 500 → should trigger (boundary is inclusive)
    const system = "a".repeat(400)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(1600) },
    ]
    const result = shouldCompact(system, messages, null, 1000, 0.50)
    expect(result).toBe(true)
  })

  it("high-threshold (0.95) does NOT trigger at 50% context usage", () => {
    // same payload as above: ~500 tokens out of 1000-token window = 50% used.
    // With threshold=0.95 the trigger is at 950 tokens → should NOT fire.
    const system = "a".repeat(400)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(1600) },
    ]
    const result = shouldCompact(system, messages, null, 1000, 0.95)
    expect(result).toBe(false)
  })

  it("respects 50% threshold when model limit is provided via modelLimit.context", () => {
    // model context = 2000 tokens, threshold=0.50 → trigger at 1000 tokens.
    // system: 800 chars = 200 tokens, message: 3200 chars = 800 tokens → 1000 total.
    // 1000 >= 1000 → should trigger
    const system = "a".repeat(800)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3200) },
    ]
    const result = shouldCompact(system, messages, { context: 2_000, output: 500 }, 100_000, 0.50)
    expect(result).toBe(true)
  })

  it("respects 50% threshold when model limit is provided via modelLimit.input", () => {
    // modelLimit.input = 2000 (preferred over .context), threshold=0.50 → trigger at 1000 tokens.
    // system: 800 chars = 200 tokens, message: 3200 chars = 800 tokens → 1000 total.
    // 1000 >= 1000 → should trigger
    const system = "a".repeat(800)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3200) },
    ]
    const result = shouldCompact(
      system,
      messages,
      { context: 10_000, input: 2_000, output: 500 },
      100_000,
      0.50,
    )
    expect(result).toBe(true)
  })

  it("returns false for a brand-new session with minimal context at 50% threshold", () => {
    // Simulates a session that has just started — only a short system prompt and one
    // greeting message.  Even with the more aggressive 50% threshold this should
    // never fire on a virtually empty context.
    const system = "You are a helpful coding assistant."
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello, let's get started." },
    ]
    // fallback = 200_000 (typical large model), threshold=0.50 → trigger at 100_000 tokens.
    // Estimated is well under 100 tokens → should NOT trigger
    const result = shouldCompact(system, messages, null, 200_000, 0.50)
    expect(result).toBe(false)
  })

  it("accepts system as an array of strings and applies 50% threshold correctly", () => {
    // system array is joined with '\n' before char-counting.
    // Two strings of 200 chars each + '\n' = 401 chars ≈ 101 tokens (ceil).
    // message: 1600 chars = 400 tokens → total = 501 tokens (ceil).
    // fallback=1000, threshold=0.50 → trigger at 500 tokens.
    // 501 >= 500 → should trigger
    const systemParts = ["a".repeat(200), "a".repeat(200)]
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(1600) },
    ]
    const result = shouldCompact(systemParts, messages, null, 1000, 0.50)
    expect(result).toBe(true)
  })
})
