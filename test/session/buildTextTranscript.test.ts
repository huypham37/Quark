import { describe, it, expect } from "bun:test"
import { buildTextTranscript } from "../../src/session/branch"
import type { MessageRow, PartRow } from "../../src/session/message"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0
function id(): string {
  return `id-${++counter}`
}

function msg(id: string, role: "user" | "assistant"): MessageRow {
  return {
    id,
    sessionId: "s1",
    role,
    modelId: null,
    providerId: null,
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

function toolPart(messageId: string, toolName: string): PartRow {
  return {
    id: id(),
    messageId,
    sessionId: "s1",
    type: "tool",
    data: JSON.stringify({ tool: toolName, input: {}, output: "ok", status: "ok" }),
  }
}

function stepFinishPart(messageId: string): PartRow {
  return {
    id: id(),
    messageId,
    sessionId: "s1",
    type: "step-finish",
    data: JSON.stringify({ reason: "stop", tokens: { input: 100, output: 50 } }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildTextTranscript", () => {
  it("keeps text parts, strips tool and step-finish parts", () => {
    const u1 = msg("u1", "user")
    const a1 = msg("a1", "assistant")

    const messages = [u1, a1]
    const parts: PartRow[] = [
      textPart("u1", "fix the bug"),
      textPart("a1", "let me check"),
      toolPart("a1", "read"),
      textPart("a1", "found it"),
      toolPart("a1", "edit"),
      stepFinishPart("a1"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe("user: fix the bug\n\nassistant: let me check\n\nassistant: found it")
  })

  it("keeps only type=text parts", () => {
    const u1 = msg("u1", "user")
    const a1 = msg("a1", "assistant")

    const messages = [u1, a1]
    const parts: PartRow[] = [
      textPart("u1", "hello"),
      toolPart("a1", "bash"),
      toolPart("a1", "read"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe("user: hello")
  })

  it("returns empty string when there are no text parts", () => {
    const a1 = msg("a1", "assistant")
    const messages = [a1]
    const parts: PartRow[] = [toolPart("a1", "read"), stepFinishPart("a1")]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe("")
  })

  it("preserves order from oldest to newest", () => {
    const u1 = msg("u1", "user")
    const a1 = msg("a1", "assistant")
    const u2 = msg("u2", "user")

    const messages = [u1, a1, u2]
    const parts: PartRow[] = [
      textPart("u1", "first"),
      textPart("a1", "second"),
      textPart("u2", "third"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe("user: first\n\nassistant: second\n\nuser: third")
  })

  it("does not include text from aborted assistant messages", () => {
    const u1 = msg("u1", "user")
    const aAborted = { ...msg("a_aborted", "assistant"), finish: "aborted" as const }
    const u2 = msg("u2", "user")
    const a1 = msg("a1", "assistant")

    const messages = [u1, aAborted, u2, a1]
    const parts: PartRow[] = [
      textPart("u1", "first question"),
      textPart("a_aborted", "partial aborted text"),
      textPart("u2", "second question"),
      textPart("a1", "real answer"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe(
      "user: first question\n\nuser: second question\n\nassistant: real answer",
    )
    expect(result).not.toContain("partial aborted text")
    expect(result).not.toContain("aborted")
  })

  it("normal messages still appear in transcript alongside aborted ones", () => {
    const u1 = msg("u1", "user")
    const aAborted = { ...msg("a_aborted", "assistant"), finish: "aborted" as const }
    const a1 = msg("a1", "assistant")

    const messages = [u1, aAborted, a1]
    const parts: PartRow[] = [
      textPart("u1", "hello"),
      textPart("a_aborted", "incomplete"),
      textPart("a1", "world"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe("user: hello\n\nassistant: world")
  })

  it("handles multiple text parts per message", () => {
    const u1 = msg("u1", "user")
    const a1 = msg("a1", "assistant")

    const messages = [u1, a1]
    const parts: PartRow[] = [
      textPart("u1", "first question"),
      textPart("a1", "part one"),
      toolPart("a1", "read"),
      textPart("a1", "part two"),
      textPart("a1", "part three"),
    ]

    const result = buildTextTranscript(messages, parts)

    expect(result).toBe(
      "user: first question\n\nassistant: part one\n\nassistant: part two\n\nassistant: part three",
    )
  })
})
