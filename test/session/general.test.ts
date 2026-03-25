import { describe, it, expect } from "bun:test"
import {
  splitMessages,
  buildTextOnlyMessages,
  findExistingAnchor,
  type AnchorData,
} from "../../src/session/methods/general"
import type { MessageRow, PartRow } from "../../src/session/message"

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

function makeTextPart(messageId: string, text: string): PartRow {
  return {
    id: nextId(),
    messageId,
    sessionId: "s1",
    type: "text",
    data: JSON.stringify({ text }),
  }
}

function makeToolPart(
  messageId: string,
  tool: string,
  output?: string,
): PartRow {
  return {
    id: nextId(),
    messageId,
    sessionId: "s1",
    type: "tool",
    data: JSON.stringify({
      tool,
      callId: nextId(),
      status: "completed",
      input: { path: "/file.ts" },
      output: output ?? "file contents here...",
    }),
  }
}

function makeSummaryPart(messageId: string, anchor: AnchorData): PartRow {
  return {
    id: nextId(),
    messageId,
    sessionId: "s1",
    type: "summary",
    data: JSON.stringify(anchor),
  }
}

// ---------------------------------------------------------------------------
// splitMessages — shared logic with anchored, verify same contract
// ---------------------------------------------------------------------------

describe("general splitMessages", () => {
  it("retains last N turns, evicts the rest", () => {
    const messages: MessageRow[] = []
    for (let i = 0; i < 5; i++) {
      messages.push(makeMsg("user"))
      messages.push(makeMsg("assistant"))
    }

    const { evicted, retained } = splitMessages(messages, 2)

    // 5 turns = 10 messages; retain 2 = 4 messages at tail
    expect(evicted.length).toBe(6)
    expect(retained.length).toBe(4)
    expect(retained[0]!.role).toBe("user")
  })

  it("returns no evictions when fewer turns than retain_turns", () => {
    const messages = [makeMsg("user"), makeMsg("assistant")]
    const { evicted, retained } = splitMessages(messages, 5)

    expect(evicted.length).toBe(0)
    expect(retained.length).toBe(2)
  })

  it("evicts everything when retain_turns=0", () => {
    const messages = [makeMsg("user"), makeMsg("assistant")]
    const { evicted, retained } = splitMessages(messages, 0)

    expect(evicted.length).toBe(2)
    expect(retained.length).toBe(0)
  })

  it("skips compaction anchor messages when counting turns", () => {
    const messages: MessageRow[] = [
      makeMsg("user"),
      makeMsg("assistant"),
      makeMsg("assistant", { providerId: "compaction" }), // anchor — not a real turn
      makeMsg("user"),
      makeMsg("assistant"),
      makeMsg("user"),
      makeMsg("assistant"),
    ]

    const { evicted, retained } = splitMessages(messages, 2)

    // 3 real turns, retain 2 → evict first turn + compaction msg
    expect(evicted.length).toBe(3) // user + assistant + compaction
    expect(retained.length).toBe(4) // 2 turns
    expect(retained[0]!.role).toBe("user")
  })
})

// ---------------------------------------------------------------------------
// buildTextOnlyMessages — key difference from anchored: tool calls are
// stripped entirely, not replaced with pruned placeholders
// ---------------------------------------------------------------------------

describe("general buildTextOnlyMessages", () => {
  it("includes only user/assistant text messages", () => {
    const user = makeMsg("user")
    const asst = makeMsg("assistant")
    const messages = [user, asst]

    const parts: PartRow[] = [
      makeTextPart(user.id, "read the file"),
      makeTextPart(asst.id, "I'll read it"),
      makeToolPart(asst.id, "read", "thousands of lines of content..."),
    ]

    const result = buildTextOnlyMessages(messages, parts)

    // Only 2 messages: the user text and assistant text
    // The tool call + result are completely absent
    expect(result.length).toBe(2)
    expect(result[0]!.role).toBe("user")
    expect(result[0]!.content).toBe("read the file")
    expect(result[1]!.role).toBe("assistant")
    expect(result[1]!.content).toBe("I'll read it")
  })

  it("drops messages that have only tool parts (no text)", () => {
    const asst = makeMsg("assistant") // only has a tool call, no text
    const parts: PartRow[] = [makeToolPart(asst.id, "bash", "output")]

    const result = buildTextOnlyMessages([asst], parts)

    // Message has no text part → excluded entirely
    expect(result.length).toBe(0)
  })

  it("joins multiple text parts in one message", () => {
    const asst = makeMsg("assistant")
    const parts: PartRow[] = [
      makeTextPart(asst.id, "first chunk"),
      makeTextPart(asst.id, "second chunk"),
    ]

    const result = buildTextOnlyMessages([asst], parts)

    expect(result.length).toBe(1)
    expect(result[0]!.content).toBe("first chunk\nsecond chunk")
  })

  it("skips compaction anchor messages", () => {
    const anchor = makeMsg("assistant", { providerId: "compaction" })
    const user = makeMsg("user")

    const parts: PartRow[] = [
      makeSummaryPart(anchor.id, { text: "old summary", compactedUntilMessageId: "x" }),
      makeTextPart(user.id, "continue the work"),
    ]

    const result = buildTextOnlyMessages([anchor, user], parts)

    // anchor should be excluded, only the user message
    expect(result.length).toBe(1)
    expect(result[0]!.role).toBe("user")
    expect(result[0]!.content).toBe("continue the work")
  })

  it("strips tool calls from messages that have both text and tool parts", () => {
    const asst = makeMsg("assistant")
    const parts: PartRow[] = [
      makeTextPart(asst.id, "Let me check the file"),
      makeToolPart(asst.id, "read", "1000 lines of output"),
      makeToolPart(asst.id, "bash", "another big output"),
    ]

    const result = buildTextOnlyMessages([asst], parts)

    // Should only include the text part — both tool parts stripped
    expect(result.length).toBe(1)
    expect(result[0]!.content).toBe("Let me check the file")
  })
})

// ---------------------------------------------------------------------------
// findExistingAnchor — same as anchored implementation
// ---------------------------------------------------------------------------

describe("general findExistingAnchor", () => {
  it("finds the most recent anchor", () => {
    const m1 = makeMsg("assistant", { providerId: "compaction" })
    const m2 = makeMsg("user")
    const m3 = makeMsg("assistant", { providerId: "compaction" })

    const anchor1: AnchorData = { text: "old anchor", compactedUntilMessageId: "a" }
    const anchor2: AnchorData = { text: "new anchor", compactedUntilMessageId: "b" }

    const parts: PartRow[] = [
      makeSummaryPart(m1.id, anchor1),
      makeTextPart(m2.id, "hello"),
      makeSummaryPart(m3.id, anchor2),
    ]

    const result = findExistingAnchor([m1, m2, m3], parts)
    expect(result).not.toBeNull()
    expect(result!.text).toBe("new anchor")
    expect(result!.compactedUntilMessageId).toBe("b")
  })

  it("returns null when no anchor exists", () => {
    const m1 = makeMsg("user")
    const parts = [makeTextPart(m1.id, "hello")]
    expect(findExistingAnchor([m1], parts)).toBeNull()
  })

  it("ignores anchors without compactedUntilMessageId", () => {
    const m1 = makeMsg("assistant", { providerId: "compaction" })
    // Simulate old-format anchor that only has text
    const parts: PartRow[] = [
      {
        id: nextId(),
        messageId: m1.id,
        sessionId: "s1",
        type: "summary",
        data: JSON.stringify({ text: "some summary" }), // missing compactedUntilMessageId
      },
    ]
    // Should return null since compactedUntilMessageId is absent
    expect(findExistingAnchor([m1], parts)).toBeNull()
  })
})
