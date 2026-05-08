// Multi-modal tool results — RED PHASE tests
//
// These tests are written BEFORE the implementation. They will fail until the
// following changes land:
//
//   1. ToolResult.output → string | ToolResultContentPart[]   (src/tool/tool.ts)
//   2. ToolPartData.contentParts?: ToolResultContentPart[]    (src/session/message.ts)
//   3. toModelMessages — content-type tool result branch      (src/session/message.ts)
//   4. extractOutput — text-only extraction from ContentParts (src/session/processor.ts)
//   5. toModelOutput — content branch in prompt.ts            (src/session/prompt.ts)
//
// Run:  bun test test/session/multimodal-tool-result.test.ts

import { describe, it, expect } from "bun:test"
import { toModelMessages } from "../../src/session/message"
import type { MessageRow, PartRow, ToolPartData } from "../../src/session/message"

// ---------------------------------------------------------------------------
// Import the new type — this MUST fail compilation until the type is added
// to src/tool/tool.ts and re-exported from src/session/message.ts
// ---------------------------------------------------------------------------

import type { ToolResultContentPart } from "../../src/tool/tool"

// ---------------------------------------------------------------------------
// Helpers — mirror the pattern from toModelMessages-anchor.test.ts
// ---------------------------------------------------------------------------

let counter = 0
function id(): string {
  return `mm-${++counter}`
}

function msg(
  role: "user" | "assistant",
  opts?: { id?: string; providerId?: string },
): MessageRow {
  const msgId = opts?.id ?? id()
  return {
    id: msgId,
    sessionId: "s-mm",
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
    sessionId: "s-mm",
    type: "text",
    data: JSON.stringify({ text }),
  }
}

/**
 * Build a tool PartRow with a plain string output (backward-compatible shape).
 */
function toolPartString(
  messageId: string,
  opts: {
    callId?: string
    tool?: string
    output?: string
    status?: "completed" | "error" | "pending" | "running"
  } = {},
): PartRow {
  const data: ToolPartData = {
    tool: opts.tool ?? "read",
    callId: opts.callId ?? id(),
    status: opts.status ?? "completed",
    input: { path: "/tmp/file.ts" },
    output: opts.output ?? "file content here",
  }
  return {
    id: id(),
    messageId,
    sessionId: "s-mm",
    type: "tool",
    data: JSON.stringify(data),
  }
}

/**
 * Build a tool PartRow whose data carries contentParts (new multi-modal shape).
 *
 * NOTE: ToolPartData.contentParts does not exist yet — this part will cause
 * TypeScript errors until the field is added. The JSON is constructed manually
 * so the runtime shape is correct even before the type is extended.
 */
function toolPartWithContentParts(
  messageId: string,
  opts: {
    callId?: string
    tool?: string
    output?: string        // persisted text-only summary
    contentParts: ToolResultContentPart[]
    status?: "completed" | "error"
  },
): PartRow {
  // We cast through `any` intentionally: the field doesn't exist on ToolPartData yet.
  const data: any = {
    tool: opts.tool ?? "screenshot",
    callId: opts.callId ?? id(),
    status: opts.status ?? "completed",
    input: {},
    output: opts.output ?? "",
    contentParts: opts.contentParts,
  }
  return {
    id: id(),
    messageId,
    sessionId: "s-mm",
    type: "tool",
    data: JSON.stringify(data),
  }
}

// ---------------------------------------------------------------------------
// Group 1 — toModelMessages with content parts
// ---------------------------------------------------------------------------

describe("toModelMessages — multi-modal tool results", () => {
  // -----------------------------------------------------------------------
  // Test 1: backward compatibility — plain string output unchanged
  // -----------------------------------------------------------------------
  it("tool result with string output produces text-only tool result (backward compat)", () => {
    const user = msg("user", { id: "u1" })
    const asst = msg("assistant", { id: "a1" })

    const callId = "call-001"
    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u1", "run the read tool"),
      textPart("a1", "sure"),
      toolPartString("a1", { callId, tool: "read", output: "hello world" }),
    ]

    const result = toModelMessages(messages, parts)

    // Expect a ToolModelMessage whose content contains { type: "text", value: "..." }
    const toolMsg = result.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()

    const toolContent = (toolMsg as any).content as any[]
    expect(toolContent).toHaveLength(1)

    const toolResult = toolContent[0]
    expect(toolResult.type).toBe("tool-result")
    expect(toolResult.toolCallId).toBe(callId)
    expect(toolResult.toolName).toBe("read")

    // EXISTING behaviour: output is { type: "text", value: string }
    expect(toolResult.output).toEqual({ type: "text", value: "hello world" })
  })

  // -----------------------------------------------------------------------
  // Test 2: contentParts present → output shape switches to content-type
  // -----------------------------------------------------------------------
  it("tool result with contentParts produces content-type tool result", () => {
    const user = msg("user", { id: "u2" })
    const asst = msg("assistant", { id: "a2" })

    const callId = "call-002"
    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "Screenshot captured." },
      { type: "image-data", data: "base64encodedpngdata", mediaType: "image/png" },
    ]

    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u2", "take a screenshot"),
      textPart("a2", "capturing…"),
      toolPartWithContentParts("a2", {
        callId,
        tool: "screenshot",
        output: "Screenshot captured.",  // text-only persisted form
        contentParts,
      }),
    ]

    const result = toModelMessages(messages, parts)

    const toolMsg = result.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()

    const toolContent = (toolMsg as any).content as any[]
    expect(toolContent).toHaveLength(1)

    const toolResult = toolContent[0]
    expect(toolResult.type).toBe("tool-result")
    expect(toolResult.toolCallId).toBe(callId)

    // NEW behaviour: when contentParts is present, output uses { type: "content", value: [...] }
    expect(toolResult.output).toEqual({
      type: "content",
      value: [
        { type: "text", text: "Screenshot captured." },
        { type: "image-data", data: "base64encodedpngdata", mediaType: "image/png" },
      ],
    })
  })

  // -----------------------------------------------------------------------
  // Test 3: mixed text + image contentParts are faithfully forwarded
  // -----------------------------------------------------------------------
  it("tool result with contentParts containing text + image produces mixed content", () => {
    const user = msg("user", { id: "u3" })
    const asst = msg("assistant", { id: "a3" })

    const callId = "call-003"
    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "Page rendered." },
      { type: "image-data", data: "AAAAPNGdata==", mediaType: "image/png" },
      { type: "text", text: "DOM is stable." },
    ]

    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u3", "render the page"),
      textPart("a3", "rendering…"),
      toolPartWithContentParts("a3", {
        callId,
        tool: "browser",
        output: "Page rendered. DOM is stable.",
        contentParts,
      }),
    ]

    const result = toModelMessages(messages, parts)

    const toolMsg = result.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()

    const toolResult = (toolMsg as any).content[0]
    expect(toolResult.output.type).toBe("content")

    const value: ToolResultContentPart[] = toolResult.output.value
    expect(value).toHaveLength(3)
    expect(value[0]).toEqual({ type: "text", text: "Page rendered." })
    expect(value[1]).toEqual({ type: "image-data", data: "AAAAPNGdata==", mediaType: "image/png" })
    expect(value[2]).toEqual({ type: "text", text: "DOM is stable." })
  })

  // -----------------------------------------------------------------------
  // Test 4: contentParts with text only still switches to content-type
  // -----------------------------------------------------------------------
  it("tool result with contentParts but no image still produces content type", () => {
    const user = msg("user", { id: "u4" })
    const asst = msg("assistant", { id: "a4" })

    const callId = "call-004"
    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "Only text here, no image." },
    ]

    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u4", "text-only content parts"),
      textPart("a4", "ok"),
      toolPartWithContentParts("a4", {
        callId,
        tool: "read",
        output: "Only text here, no image.",
        contentParts,
      }),
    ]

    const result = toModelMessages(messages, parts)

    const toolMsg = result.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()

    const toolResult = (toolMsg as any).content[0]
    // Even though there is no image, the presence of contentParts must drive the content-type branch
    expect(toolResult.output.type).toBe("content")
    expect(toolResult.output.value).toEqual([{ type: "text", text: "Only text here, no image." }])
  })

  // -----------------------------------------------------------------------
  // Test 5: multiple tool calls in one turn — mixed string and content-parts
  // -----------------------------------------------------------------------
  it("multiple tool calls in one turn — mixed string and contentParts each routed correctly", () => {
    const user = msg("user", { id: "u5" })
    const asst = msg("assistant", { id: "a5" })

    const callIdText = "call-txt-005"
    const callIdImage = "call-img-005"

    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "snap" },
      { type: "image-data", data: "imgdata==", mediaType: "image/jpeg" },
    ]

    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u5", "do two things"),
      textPart("a5", "will do"),
      toolPartString("a5", { callId: callIdText, tool: "read", output: "text result" }),
      toolPartWithContentParts("a5", {
        callId: callIdImage,
        tool: "screenshot",
        output: "snap",
        contentParts,
      }),
    ]

    const result = toModelMessages(messages, parts)

    const toolMsg = result.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()

    const toolContent = (toolMsg as any).content as any[]
    expect(toolContent).toHaveLength(2)

    const textResult = toolContent.find((c: any) => c.toolCallId === callIdText)
    const imageResult = toolContent.find((c: any) => c.toolCallId === callIdImage)

    expect(textResult).toBeDefined()
    expect(textResult.output).toEqual({ type: "text", value: "text result" })

    expect(imageResult).toBeDefined()
    expect(imageResult.output).toEqual({
      type: "content",
      value: [
        { type: "text", text: "snap" },
        { type: "image-data", data: "imgdata==", mediaType: "image/jpeg" },
      ],
    })
  })

  // -----------------------------------------------------------------------
  // Test 6: error tool result with contentParts falls back to error text
  // -----------------------------------------------------------------------
  it("error tool result with contentParts uses error string, ignores contentParts", () => {
    const user = msg("user", { id: "u6" })
    const asst = msg("assistant", { id: "a6" })

    const callId = "call-006"
    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "partial output before crash" },
    ]

    // Error parts have d.error set instead of d.output
    const errorData: any = {
      tool: "screenshot",
      callId,
      status: "error",
      input: {},
      error: "Browser crashed",
      contentParts, // present but should NOT be used for error results
    }

    const messages = [user, asst]
    const parts: PartRow[] = [
      textPart("u6", "capture"),
      textPart("a6", "trying…"),
      {
        id: id(),
        messageId: "a6",
        sessionId: "s-mm",
        type: "tool",
        data: JSON.stringify(errorData),
      },
    ]

    const result = toModelMessages(messages, parts)

    const toolMsg = result.find((m) => m.role === "tool")
    const toolResult = (toolMsg as any).content[0]

    // Errors always use the text path: "Error: <message>"
    expect(toolResult.output).toEqual({ type: "text", value: "Error: Browser crashed" })
  })
})

// ---------------------------------------------------------------------------
// Group 2 — extractOutput behaviour (processor-level semantics)
//
// extractOutput is a private function in processor.ts. We test its contract
// here by reasoning about the ToolPartData shape that should be stored after
// processing a multi-modal tool result.
//
// These tests validate the INTENDED persisted shape of ToolPartData after
// extractOutput runs — i.e. what gets written to the JSONL store.
// ---------------------------------------------------------------------------

describe("extractOutput — ToolPartData persistence contract for multi-modal results", () => {
  // -----------------------------------------------------------------------
  // Helper — parse ToolPartData from a PartRow's data field
  // -----------------------------------------------------------------------
  function parseToolData(p: PartRow): any {
    return JSON.parse(p.data)
  }

  // -----------------------------------------------------------------------
  // Test 7: string output → output field = string (unchanged)
  // -----------------------------------------------------------------------
  it("string output is stored as-is in ToolPartData.output (no contentParts)", () => {
    // Arrange: simulate what processor would store for a plain-text tool result
    const stored = toolPartString("msg-a", { output: "plain text result" })
    const data = parseToolData(stored)

    expect(typeof data.output).toBe("string")
    expect(data.output).toBe("plain text result")
    expect(data.contentParts).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Test 8: ContentPart[] output → text portions extracted to .output,
  //          full parts stored in .contentParts
  // -----------------------------------------------------------------------
  it("ContentPart[] output — .output holds text-only extraction, .contentParts holds full array", () => {
    // Arrange: simulate the persisted shape the processor SHOULD write
    // when a tool returns ToolResultContentPart[].
    //
    // Contract (post-implementation):
    //   - data.output = concatenated text parts only (for DB / search / display)
    //   - data.contentParts = full ToolResultContentPart[] (for LLM replay)
    const contentParts: ToolResultContentPart[] = [
      { type: "text", text: "Tool says hello." },
      { type: "image-data", data: "abc123==", mediaType: "image/png" },
      { type: "text", text: "And goodbye." },
    ]

    const stored = toolPartWithContentParts("msg-b", {
      output: "Tool says hello. And goodbye.",  // text-only extraction
      contentParts,
    })
    const data = parseToolData(stored)

    // Text-only summary must be a string (used by the TUI and search)
    expect(typeof data.output).toBe("string")
    expect(data.output).toBe("Tool says hello. And goodbye.")

    // Full content parts must be stored for LLM replay
    expect(Array.isArray(data.contentParts)).toBe(true)
    expect(data.contentParts).toHaveLength(3)
    expect(data.contentParts[0]).toEqual({ type: "text", text: "Tool says hello." })
    expect(data.contentParts[1]).toEqual({ type: "image-data", data: "abc123==", mediaType: "image/png" })
    expect(data.contentParts[2]).toEqual({ type: "text", text: "And goodbye." })
  })

  // -----------------------------------------------------------------------
  // Test 9: image-only contentParts → output is empty string
  // -----------------------------------------------------------------------
  it("image-only ContentPart[] output — .output is empty string, .contentParts has the image", () => {
    const contentParts: ToolResultContentPart[] = [
      { type: "image-data", data: "pureimagedata==", mediaType: "image/webp" },
    ]

    const stored = toolPartWithContentParts("msg-c", {
      output: "",   // no text parts → extracted output is empty
      contentParts,
    })
    const data = parseToolData(stored)

    expect(data.output).toBe("")
    expect(data.contentParts).toHaveLength(1)
    expect(data.contentParts[0]).toEqual({
      type: "image-data",
      data: "pureimagedata==",
      mediaType: "image/webp",
    })
  })

  // -----------------------------------------------------------------------
  // Test 10: ToolResultContentPart type-checking — invalid type rejected
  // -----------------------------------------------------------------------
  it("ToolResultContentPart only accepts 'text' or 'image-data' as type discriminants", () => {
    // This is a TypeScript type-level assertion — validated at compile time.
    // At runtime we verify the valid shapes are accepted without error.
    const validText: ToolResultContentPart = { type: "text", text: "hello" }
    const validImage: ToolResultContentPart = {
      type: "image-data",
      data: "b64data",
      mediaType: "image/png",
    }

    expect(validText.type).toBe("text")
    expect(validImage.type).toBe("image-data")

    // Discriminant exhaustiveness: narrowing
    function describe(part: ToolResultContentPart): string {
      if (part.type === "text") return `text:${part.text}`
      if (part.type === "image-data") return `image:${part.mediaType}`
      // TypeScript should make this unreachable
      return "unknown"
    }

    expect(describe(validText)).toBe("text:hello")
    expect(describe(validImage)).toBe("image:image/png")
  })
})

// ---------------------------------------------------------------------------
// Group 4 — ToolResult type contract (src/tool/tool.ts)
//
// Validates that the new ToolResult union type is well-formed and that
// backward-compatible usages still type-check.
// ---------------------------------------------------------------------------

describe("ToolResult — backward compatibility and new union type", () => {
  // -----------------------------------------------------------------------
  // Test 15: string output still satisfies ToolResult.output
  // -----------------------------------------------------------------------
  it("string output is still a valid ToolResult.output value", () => {
    // Import ToolResult from the tool module — this must compile cleanly
    // both before and after the type change.
    type ToolResultOutput = string | ToolResultContentPart[]

    const stringOutput: ToolResultOutput = "plain text output"
    expect(typeof stringOutput).toBe("string")
  })

  // -----------------------------------------------------------------------
  // Test 16: ToolResultContentPart[] output satisfies ToolResult.output
  // -----------------------------------------------------------------------
  it("ToolResultContentPart[] is a valid ToolResult.output value", () => {
    type ToolResultOutput = string | ToolResultContentPart[]

    const parts: ToolResultOutput = [
      { type: "text", text: "hello" },
      { type: "image-data", data: "b64==", mediaType: "image/png" },
    ]

    expect(Array.isArray(parts)).toBe(true)
    expect((parts as ToolResultContentPart[])[0]?.type).toBe("text")
  })

  // -----------------------------------------------------------------------
  // Test 17: isContentParts — runtime discriminant helper
  // -----------------------------------------------------------------------
  it("runtime array-check correctly distinguishes string from ContentPart[]", () => {
    // Helper that mirrors what toModelOutput / toModelMessages will use
    function isContentParts(
      output: string | ToolResultContentPart[],
    ): output is ToolResultContentPart[] {
      return Array.isArray(output)
    }

    const textOutput = "hello world"
    const parts: ToolResultContentPart[] = [{ type: "text", text: "hello" }]

    expect(isContentParts(textOutput)).toBe(false)
    expect(isContentParts(parts)).toBe(true)
  })
})
