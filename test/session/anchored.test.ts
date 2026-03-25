import { describe, it, expect } from "bun:test"
import {
  splitMessages,
  buildPrunedMessages,
  findExistingAnchor,
  type AnchorData,
} from "../../src/session/methods/anchored"
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
      output: output ?? "file contents here with lots of text...",
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
// splitMessages
// ---------------------------------------------------------------------------

describe("splitMessages", () => {
  it("keeps last N turns verbatim (retain_turns=2, 5 turns total)", () => {
    // Build 5 turns: user + assistant pairs
    const messages: MessageRow[] = []
    for (let i = 0; i < 5; i++) {
      messages.push(makeMsg("user"))
      messages.push(makeMsg("assistant"))
    }

    const { evicted, retained } = splitMessages(messages, 2)

    // 5 turns = 10 messages, retain 2 turns = 4 messages at end
    // Evicted: first 3 turns' user messages + their assistants = 6 messages
    expect(evicted.length).toBe(6)
    expect(retained.length).toBe(4)

    // Retained starts with a user message (3rd turn's user)
    expect(retained[0]!.role).toBe("user")
  })

  it("keeps everything when fewer turns than retain_turns", () => {
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

  it("skips compaction messages when counting turns", () => {
    const messages: MessageRow[] = [
      makeMsg("user"),
      makeMsg("assistant"),
      makeMsg("assistant", { providerId: "compaction" }), // anchor — not a turn
      makeMsg("user"),
      makeMsg("assistant"),
      makeMsg("user"),
      makeMsg("assistant"),
    ]

    const { evicted, retained } = splitMessages(messages, 2)

    // 3 real turns, retain 2. First turn (+ compaction msg) should be evicted.
    expect(retained[0]!.role).toBe("user")
    // Evicted should include the first turn + the compaction message
    expect(evicted.length).toBe(3) // user + assistant + compaction msg
    expect(retained.length).toBe(4) // 2 turns = 4 messages
  })
})

// ---------------------------------------------------------------------------
// buildPrunedMessages
// ---------------------------------------------------------------------------

describe("buildPrunedMessages", () => {
  it("prunes tool outputs but keeps tool call names", () => {
    const user = makeMsg("user")
    const asst = makeMsg("assistant")
    const messages = [user, asst]

    const parts: PartRow[] = [
      makeTextPart(user.id, "read the file"),
      makeTextPart(asst.id, "I'll read it"),
      makeToolPart(asst.id, "read", "very long file contents here..."),
    ]

    const result = buildPrunedMessages(messages, parts)

    // Should have: user message, assistant message (text + tool-call), tool message
    expect(result.length).toBe(3)

    // User message preserved
    expect(result[0]!.role).toBe("user")

    // Assistant has text + tool-call
    const asstMsg = result[1] as any
    expect(asstMsg.role).toBe("assistant")
    expect(asstMsg.content).toHaveLength(2)
    expect(asstMsg.content[0].type).toBe("text")
    expect(asstMsg.content[1].type).toBe("tool-call")
    expect(asstMsg.content[1].toolName).toBe("read")

    // Tool result is pruned
    const toolMsg = result[2] as any
    expect(toolMsg.role).toBe("tool")
    expect(toolMsg.content[0].output.value).toBe("[output pruned for compaction]")
  })

  it("preserves error status in pruned tool results", () => {
    const asst = makeMsg("assistant")
    const parts: PartRow[] = [
      {
        id: nextId(),
        messageId: asst.id,
        sessionId: "s1",
        type: "tool",
        data: JSON.stringify({
          tool: "bash",
          callId: "c1",
          status: "error",
          input: { command: "rm -rf /" },
          error: "Permission denied",
        }),
      },
    ]

    const result = buildPrunedMessages([asst], parts)
    const toolMsg = result[1] as any
    expect(toolMsg.content[0].output.value).toBe("Error: Permission denied")
  })

  it("skips compaction anchor messages", () => {
    const anchor = makeMsg("assistant", { providerId: "compaction" })
    const user = makeMsg("user")
    const parts: PartRow[] = [
      makeSummaryPart(anchor.id, { text: "old summary", compactedUntilMessageId: "x" }),
      makeTextPart(user.id, "hello"),
    ]

    const result = buildPrunedMessages([anchor, user], parts)
    // Should only have the user message, not the anchor
    expect(result.length).toBe(1)
    expect(result[0]!.role).toBe("user")
  })
})

// ---------------------------------------------------------------------------
// findExistingAnchor
// ---------------------------------------------------------------------------

describe("findExistingAnchor", () => {
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

  it("merges two summaries by including prior anchor in context", () => {
    // This test validates the merge flow conceptually:
    // When findExistingAnchor returns a prior anchor, execute() includes it
    // in the prompt so the LLM merges old + new. We test the finder here.
    const m1 = makeMsg("assistant", { providerId: "compaction" })
    const anchor: AnchorData = {
      text: "## Goal\nBuild feature X\n## Accomplished\nStep 1 done",
      compactedUntilMessageId: "msg-5",
    }
    const parts = [makeSummaryPart(m1.id, anchor)]

    const found = findExistingAnchor([m1], parts)
    expect(found!.text).toContain("Build feature X")
    expect(found!.text).toContain("Step 1 done")
  })
})
