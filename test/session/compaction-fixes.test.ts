// Tests for compaction bug fixes
//
// Covers four issues:
//   Issue 1 — retain_turns cascade: splitMessages returns evicted=[] when
//              turns < retainTurns; cascade should keep trying lower N.
//   Issue 2 — Hardcoded 0.50 override should respect config threshold instead.
//              (No new unit test needed beyond documenting the intended contract.)
//   Issue 3 — Use real token count from step-finish parts instead of chars/4
//              estimate when deciding whether to compact mid-stream.
//   Issue 4 — isOverContextThreshold helper for mid-stream compaction decisions.
//
// Tests marked with a comment "// FAILS UNTIL FIX LANDS" exercise behaviour
// that does not exist yet. They must be converted from .todo() once the
// corresponding fix is merged.

import { describe, it, expect } from "bun:test"

import {
  splitMessages,
  cascadeSplit,
} from "../../src/session/methods/general"
import {
  getLastInputTokens,
  isOverContextThreshold,
  shouldCompactWithRealTokens,
} from "../../src/session/compaction"
import type { MessageRow, PartRow } from "../../src/session/message"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _id = 0
function uid(): string {
  return `id-${++_id}`
}

/** Build a minimal MessageRow. */
function makeMsg(
  role: "user" | "assistant",
  opts?: { providerId?: string; sessionId?: string },
): MessageRow {
  return {
    id: uid(),
    sessionId: opts?.sessionId ?? "sess-1",
    role,
    modelId: role === "assistant" ? "model-x" : null,
    providerId: opts?.providerId ?? null,
    finish: role === "assistant" ? "stop" : null,
    cost: null,
    tokensIn: null,
    tokensOut: null,
    timeCreated: Date.now(),
    timeCompleted: role === "assistant" ? Date.now() : null,
  }
}

/** Build a step-finish PartRow with a given input token count. */
function makeStepFinishPart(messageId: string, inputTokens: number): PartRow {
  return {
    id: uid(),
    messageId,
    sessionId: "sess-1",
    type: "step-finish",
    data: JSON.stringify({
      reason: "stop",
      tokens: { input: inputTokens, output: 100 },
    }),
  }
}

/** Build a non-step-finish part (e.g. "text"). */
function makeTextPart(messageId: string, text: string): PartRow {
  return {
    id: uid(),
    messageId,
    sessionId: "sess-1",
    type: "text",
    data: JSON.stringify({ text }),
  }
}

// ---------------------------------------------------------------------------
// Issue 1 — splitMessages retain_turns cascade
// ---------------------------------------------------------------------------

describe("splitMessages (general) — current behaviour", () => {
  // Verify the documented baseline before fixing so we know exactly what
  // changes when Issue 1 is resolved.

  it("evicts all messages when retainTurns=0", () => {
    // retainTurns <= 0 → early return: evicted=all, retained=[]
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const a2 = makeMsg("assistant")
    const messages = [u1, a1, u2, a2]

    const { evicted, retained } = splitMessages(messages, 0)

    expect(evicted).toHaveLength(4)
    expect(retained).toHaveLength(0)
  })

  it("evicts nothing and retains all when turns < retainTurns (splitMessages alone)", () => {
    // 2 user/assistant pairs = 2 turns, retainTurns=5
    // splitMessages (without cascade) returns evicted=[], retained=[all]
    // This is correct for splitMessages — cascadeSplit handles the cascade.
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const a2 = makeMsg("assistant")
    const messages = [u1, a1, u2, a2]

    const { evicted, retained } = splitMessages(messages, 5)

    // splitMessages correctly returns all as retained — cascadeSplit wraps this.
    expect(evicted).toHaveLength(0)
    expect(retained).toHaveLength(4)
  })

  it("correctly splits when exact turns match retainTurns", () => {
    // 3 messages: user → assistant → user (last user starts turn 1 from the end,
    // first user starts turn 2). retainTurns=1 → retain last turn only.
    const u1 = makeMsg("user")    // turn 2 from end
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")    // turn 1 from end  ← splitIdx lands here
    const messages = [u1, a1, u2]

    const { evicted, retained } = splitMessages(messages, 1)

    // u1 and a1 are evicted; u2 is retained
    expect(evicted).toHaveLength(2)
    expect(evicted.map((m) => m.id)).toEqual([u1.id, a1.id])
    expect(retained).toHaveLength(1)
    expect(retained[0]!.id).toBe(u2.id)
  })

  it("retains all messages when retainTurns=0 edge check (empty list)", () => {
    const { evicted, retained } = splitMessages([], 0)

    expect(evicted).toHaveLength(0)
    expect(retained).toHaveLength(0)
  })

  it("retains everything when message list is empty regardless of retainTurns", () => {
    const { evicted, retained } = splitMessages([], 10)

    expect(evicted).toHaveLength(0)
    expect(retained).toHaveLength(0)
  })

  it("skips compaction anchor messages when counting turns", () => {
    // Compaction anchor is a special assistant message with providerId='compaction'.
    // It must not count as a real turn boundary.
    const anchor = makeMsg("assistant", { providerId: "compaction" })
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const messages = [anchor, u1, a1, u2]

    // retainTurns=1 → retain last turn (u2). u1+a1 should be evicted.
    // The anchor at index 0 is skipped during counting.
    const { evicted, retained } = splitMessages(messages, 1)

    expect(retained.map((m) => m.id)).toContain(u2.id)
    expect(evicted.map((m) => m.id)).toContain(u1.id)
    expect(evicted.map((m) => m.id)).toContain(a1.id)
  })
})

// ---------------------------------------------------------------------------
// Issue 1 — cascadeSplit (new helper, post-fix)
//
// cascadeSplit(messages, retainTurns) tries retainTurns, retainTurns-1, …, 0
// until it finds a split that produces at least one evicted message.
// If even retainTurns=0 evicts nothing (empty list) it returns evicted=[],
// retained=[].
//
// These tests are written against the INTENDED API.
// They will FAIL until cascadeSplit is added to src/session/methods/general.ts
// and exported.
// ---------------------------------------------------------------------------

describe("cascadeSplit (general)", () => {
  it("returns all evicted when retainTurns=0 (cascade bottom)", () => {
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const a2 = makeMsg("assistant")
    const messages = [u1, a1, u2, a2]

    const { evicted, retained } = cascadeSplit(messages, 0)

    expect(evicted).toHaveLength(4)
    expect(retained).toHaveLength(0)
  })

  it("cascades down from 5 to 1 and evicts something when only 2 turns exist", () => {
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const a2 = makeMsg("assistant")
    const messages = [u1, a1, u2, a2]

    const { evicted, retained } = cascadeSplit(messages, 5)

    expect(evicted.length).toBeGreaterThan(0)
    expect(retained.length).toBeGreaterThan(0)
  })

  it("returns evicted=[] retained=[] when messages list is empty regardless of retainTurns", () => {
    const { evicted, retained } = cascadeSplit([], 10)

    expect(evicted).toHaveLength(0)
    expect(retained).toHaveLength(0)
  })

  it("does not cascade past 0 (stops at retainTurns=0 which is the floor)", () => {
    const singleUser = makeMsg("user")
    const { evicted, retained } = cascadeSplit([singleUser], 3)

    expect(evicted).toHaveLength(1)
    expect(retained).toHaveLength(0)
  })

  it("prefers the highest retainTurns that produces non-empty eviction", () => {
    // 3 turns: u1/a1, u2/a2, u3/a3
    const u1 = makeMsg("user")
    const a1 = makeMsg("assistant")
    const u2 = makeMsg("user")
    const a2 = makeMsg("assistant")
    const u3 = makeMsg("user")
    const a3 = makeMsg("assistant")
    const messages = [u1, a1, u2, a2, u3, a3]

    const { evicted, retained } = cascadeSplit(messages, 5)

    // cascade: try 5 → 0 evicted, try 4 → 0 evicted, try 3 → 0 evicted,
    //          try 2 → evicts first turn (u1, a1)
    expect(evicted).toHaveLength(2)
    expect(evicted.map((m) => m.id)).toEqual([u1.id, a1.id])
    expect(retained).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Issue 3 — getLastInputTokens (existing function, more targeted tests)
//
// These assert the exact contract used by the "real tokens" fix:
// read the LAST step-finish part's input token count from a parts array.
// ---------------------------------------------------------------------------

describe("getLastInputTokens", () => {
  it("returns 0 when parts array is empty", () => {
    expect(getLastInputTokens([])).toBe(0)
  })

  it("returns 0 when no step-finish parts exist", () => {
    const mid = uid()
    const parts: PartRow[] = [
      makeTextPart(mid, "hello world"),
    ]
    expect(getLastInputTokens(parts)).toBe(0)
  })

  it("returns the input token count from a single step-finish part", () => {
    const mid = uid()
    const parts: PartRow[] = [makeStepFinishPart(mid, 3500)]
    expect(getLastInputTokens(parts)).toBe(3500)
  })

  it("returns the LAST step-finish input count when multiple exist", () => {
    // Simulates multi-step agent turn: each step emits its own step-finish.
    // We want the final (most recent) one because that reflects actual
    // context-window usage at the point compaction is evaluated.
    const mid = uid()
    const parts: PartRow[] = [
      makeStepFinishPart(mid, 1000),
      makeStepFinishPart(mid, 2000),
      makeStepFinishPart(mid, 5000), // ← last
    ]
    expect(getLastInputTokens(parts)).toBe(5000)
  })

  it("skips non-step-finish parts and still finds the correct value", () => {
    const mid = uid()
    const parts: PartRow[] = [
      makeTextPart(mid, "some text"),
      makeStepFinishPart(mid, 4200),
      makeTextPart(mid, "more text"),
    ]
    expect(getLastInputTokens(parts)).toBe(4200)
  })

  it("returns 0 gracefully when step-finish data has no tokens field", () => {
    const mid = uid()
    const parts: PartRow[] = [
      {
        id: uid(),
        messageId: mid,
        sessionId: "sess-1",
        type: "step-finish",
        data: JSON.stringify({ reason: "stop" }), // tokens field absent
      },
    ]
    expect(getLastInputTokens(parts)).toBe(0)
  })

  it("returns 0 gracefully when step-finish tokens.input is undefined", () => {
    const mid = uid()
    const parts: PartRow[] = [
      {
        id: uid(),
        messageId: mid,
        sessionId: "sess-1",
        type: "step-finish",
        data: JSON.stringify({
          reason: "stop",
          tokens: { output: 200 }, // input key absent
        }),
      },
    ]
    expect(getLastInputTokens(parts)).toBe(0)
  })

  it("skips malformed JSON without throwing", () => {
    const mid = uid()
    const parts: PartRow[] = [
      {
        id: uid(),
        messageId: mid,
        sessionId: "sess-1",
        type: "step-finish",
        data: "not-valid-json",
      },
      makeStepFinishPart(mid, 7777), // valid part after malformed one
    ]
    // Should survive malformed data and return the valid last value
    expect(getLastInputTokens(parts)).toBe(7777)
  })
})

// ---------------------------------------------------------------------------
// Issue 3 — shouldCompactWithRealTokens (new function, post-fix)
//
// A new compaction.ts export that checks whether REAL input token counts
// from step-finish parts cross the threshold, falling back to the chars/4
// estimate when no step-finish parts are available.
//
// These tests describe the INTENDED contract and will FAIL until the
// function is added to src/session/compaction.ts.
// ---------------------------------------------------------------------------

describe("shouldCompactWithRealTokens", () => {
  it("returns true when last step-finish input tokens exceed threshold × contextWindow", () => {
    const mid = uid()
    const parts: PartRow[] = [makeStepFinishPart(mid, 5_000)]
    // contextWindow=10_000, threshold=0.4 → trigger at 4_000
    // last step-finish input=5_000 → 5000 >= 4000 → true
    const result = shouldCompactWithRealTokens("", [], null, 10_000, 0.4, parts)
    expect(result).toBe(true)
  })

  it("returns false when last step-finish input tokens are below threshold × contextWindow", () => {
    const mid = uid()
    const parts: PartRow[] = [makeStepFinishPart(mid, 5_000)]
    // contextWindow=10_000, threshold=0.6 → trigger at 6_000
    // last step-finish input=5_000 → 5000 < 6000 → false
    const result = shouldCompactWithRealTokens("", [], null, 10_000, 0.6, parts)
    expect(result).toBe(false)
  })

  it("falls back to chars/4 estimate when no step-finish parts are present", () => {
    const system = "a".repeat(400)        // ~100 tokens
    const msgs: import("ai").ModelMessage[] = [{ role: "user", content: "b".repeat(2400) }] // ~600 tokens
    // total ~700 tokens, fallback=1000, threshold=0.50 → trigger at 500 → true
    const result = shouldCompactWithRealTokens(system, msgs, null, 1_000, 0.50, [])
    expect(result).toBe(true)
  })

  it("prefers real token count over chars/4 estimate even when estimate would not trigger", () => {
    // chars/4 estimate says ~3 tokens (well below threshold)
    // but step-finish reports 6_000 tokens (above threshold)
    const system = "hi"
    const msgs: import("ai").ModelMessage[] = [{ role: "user", content: "hello" }]
    const mid = uid()
    const parts: PartRow[] = [makeStepFinishPart(mid, 6_000)]
    const result = shouldCompactWithRealTokens(system, msgs, null, 10_000, 0.6, parts)
    expect(result).toBe(true)
  })

  it("uses the LAST step-finish part when multiple exist (same as getLastInputTokens)", () => {
    const mid = uid()
    const parts: PartRow[] = [makeStepFinishPart(mid, 1_000), makeStepFinishPart(mid, 9_000)]
    // contextWindow=10_000, threshold=0.85 → trigger at 8_500
    // last step-finish=9_000 → 9000 >= 8500 → true
    const result = shouldCompactWithRealTokens("", [], null, 10_000, 0.85, parts)
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Issue 4 — isOverContextThreshold (new helper, post-fix)
//
// A tiny, pure helper that centralises the percentage comparison:
//   isOverContextThreshold(inputTokens, contextWindow, threshold) → boolean
//
// This replaces ad-hoc inline comparisons scattered across processor.ts and
// compaction.ts and makes the mid-stream compaction gate easy to unit-test.
//
// These tests will FAIL until isOverContextThreshold is exported from
// src/session/compaction.ts.
// ---------------------------------------------------------------------------

describe("isOverContextThreshold", () => {
  it("returns true when inputTokens >= threshold × contextWindow", () => {
    expect(isOverContextThreshold(6_000, 10_000, 0.6)).toBe(true)
  })

  it("returns false when inputTokens < threshold × contextWindow", () => {
    expect(isOverContextThreshold(5_999, 10_000, 0.6)).toBe(false)
  })

  it("returns true at the exact boundary (inclusive)", () => {
    expect(isOverContextThreshold(6_000, 10_000, 0.6)).toBe(true)
  })

  it("handles threshold=0 — anything >= 0 tokens triggers (always true for any non-zero input)", () => {
    expect(isOverContextThreshold(1, 10_000, 0)).toBe(true)
  })

  it("handles threshold=1.0 — only triggers when inputTokens >= full context window", () => {
    expect(isOverContextThreshold(9_999, 10_000, 1.0)).toBe(false)
    expect(isOverContextThreshold(10_000, 10_000, 1.0)).toBe(true)
  })

  it("handles zero inputTokens — never triggers unless threshold is also 0", () => {
    expect(isOverContextThreshold(0, 10_000, 0.5)).toBe(false)
    expect(isOverContextThreshold(0, 10_000, 0.0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Issue 2 — hardcoded 0.50 override replaced by config threshold
//
// The execute() methods in general.ts and anchored.ts call shouldCompact with
// a hardcoded 0.50 when the initial split evicts nothing. The fix makes them
// read the threshold from config instead.
//
// The pure logic of shouldCompact itself is already well-covered in
// shouldCompact.test.ts. We document the contract here for review:
// ---------------------------------------------------------------------------

describe("Issue 2 — hardcoded 0.50 override contract (documentation)", () => {
  // The context-override in execute() guards against the turn-count gate
  // blocking compaction when the context is already heavily utilised. The fix
  // must pass config.compact.threshold instead of the literal 0.50 so that
  // users who set a higher threshold (e.g. 0.80) do not get premature cascades.
  //
  // This is enforced by integration tests, not by a pure unit test, because it
  // requires config mocking. The contract is:
  //
  //   shouldCompact(agentPrompt, modelMessages, budget, contextWindow,
  //                 config.compact.threshold)   ← config value, not literal 0.50
  //
  // When the fix lands, search for the literal "0.50" in general.ts and
  // anchored.ts and confirm it is gone.

  it("shouldCompact respects arbitrary threshold — sanity check", () => {
    // 700 tokens used out of 1000-token window.
    // threshold=0.80 → trigger at 800 → should NOT fire (700 < 800).
    // This is the exact scenario where the hardcoded 0.50 would incorrectly
    // fire (700 >= 500) but the correct config threshold (0.80) would not.
    const { shouldCompact } = require("../../src/session/compaction")
    const system = "a".repeat(400)  // 100 tokens
    const msgs = [{ role: "user", content: "b".repeat(2400) }] // 600 tokens
    // total ≈ 700 tokens
    expect(shouldCompact(system, msgs, null, 1_000, 0.80)).toBe(false)
    // Same payload at 0.50 DOES fire — this is the bug the fix resolves
    expect(shouldCompact(system, msgs, null, 1_000, 0.50)).toBe(true)
  })
})
