import { describe, it, expect } from "bun:test"
import { toModelMessages } from "../../src/session/message"
import type { MessageRow, PartRow } from "../../src/session/message"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0
function id(): string {
  return `msg-${++counter}`
}

function msg(role: "user" | "assistant", opts?: { id?: string; providerId?: string }): MessageRow {
  const msgId = opts?.id ?? id()
  return {
    id: msgId,
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

function textPart(messageId: string, text: string): PartRow {
  return {
    id: id(),
    messageId,
    sessionId: "s1",
    type: "text",
    data: JSON.stringify({ text }),
  }
}

function anchorPart(messageId: string, text: string, compactedUntilMessageId: string): PartRow {
  return {
    id: id(),
    messageId,
    sessionId: "s1",
    type: "summary",
    data: JSON.stringify({ text, compactedUntilMessageId }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toModelMessages with anchor", () => {
  it("messages before anchor are excluded", () => {
    // Setup: 3 old messages, then anchor pointing to msg-old-3, then 2 new messages
    const m1 = msg("user", { id: "old-1" })
    const m2 = msg("assistant", { id: "old-2" })
    const m3 = msg("user", { id: "old-3" })
    const anchor = msg("assistant", { id: "anchor-1", providerId: "compaction" })
    const m4 = msg("user", { id: "new-1" })
    const m5 = msg("assistant", { id: "new-2" })

    const messages = [m1, m2, m3, anchor, m4, m5]
    const parts: PartRow[] = [
      textPart("old-1", "hello"),
      textPart("old-2", "hi there"),
      textPart("old-3", "do something"),
      anchorPart("anchor-1", "## Summary\nWe discussed stuff", "old-3"),
      textPart("new-1", "now do this"),
      textPart("new-2", "done"),
    ]

    const result = toModelMessages(messages, parts)

    // First message should be the anchor summary
    expect(result[0]).toEqual({ role: "user", content: "## Summary\nWe discussed stuff" })

    // Then the new messages
    expect(result[1]).toEqual({ role: "user", content: "now do this" })
    expect(result[2]).toEqual({ role: "assistant", content: [{ type: "text", text: "done" }] })

    // Total: 3 messages (anchor summary + 2 new)
    expect(result.length).toBe(3)
  })

  it("messages after anchor are included verbatim", () => {
    const m1 = msg("user", { id: "a1" })
    const anchor = msg("assistant", { id: "anch", providerId: "compaction" })
    const m2 = msg("user", { id: "b1" })
    const m3 = msg("assistant", { id: "b2" })
    const m4 = msg("user", { id: "b3" })

    const messages = [m1, anchor, m2, m3, m4]
    const parts: PartRow[] = [
      textPart("a1", "old msg"),
      anchorPart("anch", "summary of old", "a1"),
      textPart("b1", "new question"),
      textPart("b2", "new answer"),
      textPart("b3", "follow up"),
    ]

    const result = toModelMessages(messages, parts)

    // anchor summary + 3 new messages
    expect(result.length).toBe(4)
    expect(result[0]).toEqual({ role: "user", content: "summary of old" })
    expect(result[1]).toEqual({ role: "user", content: "new question" })
    expect(result[2]).toEqual({ role: "assistant", content: [{ type: "text", text: "new answer" }] })
    expect(result[3]).toEqual({ role: "user", content: "follow up" })
  })

  it("no anchor = existing behavior unchanged", () => {
    const m1 = msg("user", { id: "x1" })
    const m2 = msg("assistant", { id: "x2" })
    const m3 = msg("user", { id: "x3" })

    const messages = [m1, m2, m3]
    const parts: PartRow[] = [
      textPart("x1", "first"),
      textPart("x2", "response"),
      textPart("x3", "second"),
    ]

    const result = toModelMessages(messages, parts)

    expect(result.length).toBe(3)
    expect(result[0]).toEqual({ role: "user", content: "first" })
    expect(result[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "response" }] })
    expect(result[2]).toEqual({ role: "user", content: "second" })
  })

  it("legacy summary without compactedUntilMessageId still works", () => {
    // Old-style summary: no compactedUntilMessageId field
    const m1 = msg("user", { id: "l1" })
    const m2 = msg("assistant", { id: "l2" })
    const anchor = msg("assistant", { id: "legacy-anchor", providerId: "compaction" })
    const m3 = msg("user", { id: "l3" })

    const messages = [m1, m2, anchor, m3]
    const parts: PartRow[] = [
      textPart("l1", "old"),
      textPart("l2", "old reply"),
      // Legacy summary part — no compactedUntilMessageId
      {
        id: id(),
        messageId: "legacy-anchor",
        sessionId: "s1",
        type: "summary",
        data: JSON.stringify({ text: "legacy summary" }),
      },
      textPart("l3", "new msg"),
    ]

    const result = toModelMessages(messages, parts)

    // Should inject summary and start after anchor
    expect(result[0]).toEqual({ role: "user", content: "legacy summary" })
    expect(result[1]).toEqual({ role: "user", content: "new msg" })
    expect(result.length).toBe(2)
  })
})
