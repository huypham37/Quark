// Tests for splitMessages context-aware compaction override (issue #69)
//
// Covers:
//   1. splitMessages: fewer turns than retainTurns → empty evicted (existing)
//   2. splitMessages: more turns than retainTurns → evicts correctly (existing)
//   3. Context-override logic: when evicted.length === 0 BUT context > 50%,
//      re-split with retainTurns=1 should produce a non-empty eviction.

import { describe, it, expect } from "bun:test"
import { splitMessages } from "../../../src/session/methods/general"
import { shouldCompact } from "../../../src/session/compaction"
import type { MessageRow } from "../../../src/session/message"
import type { ModelMessage } from "ai"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0
function nextId(): string {
  return `id-${++idCounter}`
}

function makeMsg(
  role: "user" | "assistant",
  opts?: { providerId?: string },
): MessageRow {
  return {
    id: nextId(),
    sessionId: "s1",
    role,
    modelId: null,
    providerId: opts?.providerId ?? null,
    finish: role === "assistant" ? "stop" : null,
    cost: null,
    tokensIn: null,
    tokensOut: null,
    timeCreated: Date.now(),
    timeCompleted: Date.now(),
  }
}

/** Build a flat message array of N user+assistant turn pairs */
function makeTurns(n: number): MessageRow[] {
  const msgs: MessageRow[] = []
  for (let i = 0; i < n; i++) {
    msgs.push(makeMsg("user"))
    msgs.push(makeMsg("assistant"))
  }
  return msgs
}

// ---------------------------------------------------------------------------
// 1. Existing behaviour — fewer turns than retainTurns
// ---------------------------------------------------------------------------

describe("splitMessages — fewer turns than retainTurns (issue #69 baseline)", () => {
  it("returns empty evicted when session has 2 turns and retainTurns=5", () => {
    const messages = makeTurns(2) // 2 turns = 4 messages

    const { evicted, retained } = splitMessages(messages, 5)

    expect(evicted.length).toBe(0)
    expect(retained.length).toBe(4)
    expect(retained).toEqual(messages)
  })

  it("all messages are retained and none are lost", () => {
    const messages = makeTurns(2)

    const { evicted, retained } = splitMessages(messages, 5)

    // Verify every message is in retained and nothing is duplicated
    const allRetainedIds = retained.map((m) => m.id)
    expect(new Set(allRetainedIds).size).toBe(retained.length)
    for (const msg of messages) {
      expect(allRetainedIds).toContain(msg.id)
    }
    expect(evicted.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Existing behaviour — more turns than retainTurns
// ---------------------------------------------------------------------------

describe("splitMessages — 6 turns with retainTurns=5 (issue #69 baseline)", () => {
  it("evicts the oldest turn and retains the 5 most recent", () => {
    const messages = makeTurns(6) // 6 turns = 12 messages

    const { evicted, retained } = splitMessages(messages, 5)

    // 6 turns − 5 retained = 1 evicted turn = 2 messages
    expect(evicted.length).toBe(2)
    expect(retained.length).toBe(10)
  })

  it("retained block starts with a user message", () => {
    const messages = makeTurns(6)

    const { retained } = splitMessages(messages, 5)

    expect(retained[0]!.role).toBe("user")
  })

  it("evicted messages are the oldest ones in order", () => {
    const messages = makeTurns(6)

    const { evicted, retained } = splitMessages(messages, 5)

    // Verify the evicted messages come before all retained messages
    // (i.e., every evicted message's original index < every retained message's original index)
    const originalOrder = new Map(messages.map((m, i) => [m.id, i]))
    const maxEvictedIdx = Math.max(...evicted.map((m) => originalOrder.get(m.id)!))
    const minRetainedIdx = Math.min(...retained.map((m) => originalOrder.get(m.id)!))

    expect(maxEvictedIdx).toBeLessThan(minRetainedIdx)
  })

  it("evicted + retained together equal the full message list", () => {
    const messages = makeTurns(6)

    const { evicted, retained } = splitMessages(messages, 5)

    const combined = [...evicted, ...retained]
    expect(combined.length).toBe(messages.length)
    for (const msg of messages) {
      expect(combined.map((m) => m.id)).toContain(msg.id)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Context-override logic: context > 50% AND turns < retainTurns
//
// The new execute() behaviour in both general.ts and anchored.ts:
//   if (evicted.length === 0 && shouldCompact(..., threshold=0.50)) {
//     re-split with retainTurns=1
//   }
//
// We validate the two conditions independently and then their interaction.
// ---------------------------------------------------------------------------

describe("context-override: shouldCompact at 50% with low turn count", () => {
  it("shouldCompact returns false for a small session (no override needed)", () => {
    // A 2-turn session is tiny → well under 50% of any real context window.
    const system = "You are a helpful coding assistant."
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello." },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4." },
    ]

    const result = shouldCompact(system, messages, null, 200_000, 0.50)

    expect(result).toBe(false)
  })

  it("shouldCompact returns true when context exceeds 50% even with few turns", () => {
    // Simulate a 2-turn session that has large messages (e.g., after reading big files)
    // system: 2000 chars = 500 tokens; messages: 6000 chars = 1500 tokens → 2000 total
    // fallback=3000, threshold=0.50 → trigger at 1500 tokens; 2000 >= 1500 → true
    const system = "a".repeat(2000)
    const messages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3000) }, // ~750 tokens
      { role: "assistant", content: "c".repeat(3000) }, // ~750 tokens
    ]

    const result = shouldCompact(system, messages, null, 3000, 0.50)

    expect(result).toBe(true)
  })

  it("re-splitting with retainTurns=1 produces evictions when original split was empty", () => {
    // Simulates the override path: splitMessages returned empty evicted (only 2 turns,
    // retainTurns=5), but context is high → caller re-splits with retainTurns=1.
    const messages = makeTurns(2) // 2 turns — fewer than retainTurns=5

    // First split: no evictions (existing behaviour)
    const firstSplit = splitMessages(messages, 5)
    expect(firstSplit.evicted.length).toBe(0)

    // Context override fires → re-split with retainTurns=1
    const overrideSplit = splitMessages(messages, 1)

    // With 2 turns and retainTurns=1, the first turn must be evicted
    expect(overrideSplit.evicted.length).toBeGreaterThan(0)
    expect(overrideSplit.retained.length).toBeGreaterThan(0)
    // Exactly 1 turn retained = 2 messages
    expect(overrideSplit.retained.length).toBe(2)
    expect(overrideSplit.retained[0]!.role).toBe("user")
  })

  it("re-split with retainTurns=1 keeps only the most recent turn", () => {
    // 3 turns → override with retainTurns=1 should keep last turn (2 msgs), evict 4
    const messages = makeTurns(3) // 6 messages

    const { evicted, retained } = splitMessages(messages, 1)

    expect(retained.length).toBe(2)
    expect(evicted.length).toBe(4)
    expect(retained[0]!.role).toBe("user")
  })

  it("override condition is independent: shouldCompact AND splitMessages together", () => {
    // This test models the exact gate used in execute():
    //   if (evicted.length === 0 && shouldCompact(agentPrompt, modelMessages, budget, ctxWindow, 0.50))
    //     → re-split with retainTurns=1
    const messages = makeTurns(2)

    // Step 1: normal split returns no evictions
    const { evicted } = splitMessages(messages, 5)
    expect(evicted.length).toBe(0) // precondition

    // Step 2: context is over 50%
    const system = "a".repeat(2000) // 500 tokens
    const modelMessages: ModelMessage[] = [
      { role: "user", content: "b".repeat(3000) },  // 750 tokens
      { role: "assistant", content: "c".repeat(3000) }, // 750 tokens
    ]
    const highContext = shouldCompact(system, modelMessages, null, 3000, 0.50)
    expect(highContext).toBe(true) // precondition

    // Step 3: both conditions met → the override applies → re-split forces compaction
    const overrideSplit = splitMessages(messages, 1)
    expect(overrideSplit.evicted.length).toBeGreaterThan(0)
  })

  it("override does NOT apply when context is below 50%", () => {
    // evicted.length is 0 AND context is low → neither condition triggers → no compaction
    const messages = makeTurns(2)

    const { evicted } = splitMessages(messages, 5)
    expect(evicted.length).toBe(0) // first condition met

    const system = "You are a helpful assistant."
    const modelMessages: ModelMessage[] = [
      { role: "user", content: "Hello." },
      { role: "assistant", content: "Hi!" },
    ]
    const lowContext = shouldCompact(system, modelMessages, null, 200_000, 0.50)
    expect(lowContext).toBe(false) // second condition NOT met → no override

    // Compaction is correctly skipped — no re-split needed
    // (the execute() function checks BOTH conditions before re-splitting)
  })

  it("override respects modelLimit.context when provided", () => {
    // Verify shouldCompact respects a real model budget (not just the fallback)
    // model context=4000, threshold=0.50 → trigger at 2000 tokens.
    // system: 2000 chars = 500 tokens; messages: 6000 chars = 1500 tokens → 2000 total → trigger
    const system = "a".repeat(2000)
    const modelMessages: ModelMessage[] = [
      { role: "user", content: "b".repeat(6000) },
    ]

    const result = shouldCompact(
      system,
      modelMessages,
      { context: 4000, output: 500 },
      200_000,  // fallback (should not be used)
      0.50,
    )

    expect(result).toBe(true)
  })

  it("override respects agentPrompt as string[] (array system prompt)", () => {
    // CompactMethodContext.agentPrompt can be string | string[]
    // shouldCompact joins array with '\n' — verify it triggers correctly
    const systemParts = ["a".repeat(1000), "a".repeat(1000)] // 2001 chars ~501 tokens
    const modelMessages: ModelMessage[] = [
      { role: "user", content: "b".repeat(4000) }, // 1000 tokens
    ]
    // total ~1501 tokens; fallback=3000, threshold=0.50 → trigger at 1500 → true
    const result = shouldCompact(systemParts, modelMessages, null, 3000, 0.50)

    expect(result).toBe(true)
  })
})
