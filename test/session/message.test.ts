import { describe, test, expect } from "bun:test";
import { toModelMessages } from "../../src/session/message";
import type { MessageRow, PartRow } from "../../src/session/message";

describe("toModelMessages reasoning replay", () => {
  test("preserves reasoning content in assistant messages", () => {
    const messages: MessageRow[] = [
      {
        id: "m1",
        sessionId: "s1",
        providerId: "copilot",
        modelId: "gpt-5",
        role: "assistant",
        status: "completed",
        createdAt: "",
        timeCompleted: null,
        tokensIn: null,
        tokensOut: null,
      },
    ];
    const parts: PartRow[] = [
      {
        id: "p1",
        messageId: "m1",
        sessionId: "s1",
        type: "reasoning",
        data: JSON.stringify({ text: "Let me think about this..." }),
      },
      {
        id: "p2",
        messageId: "m1",
        sessionId: "s1",
        type: "text",
        data: JSON.stringify({ text: "Here is the answer." }),
      },
    ];

    const result = toModelMessages(messages, parts);
    expect(result.length).toBe(1);
    expect(result[0]!.role).toBe("assistant");

    const content = result[0]!.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(2);

    // Check reasoning part
    const reasoningPart = content.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart!.text).toBe("Let me think about this...");

    // Check text part
    const textPart = content.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(textPart!.text).toBe("Here is the answer.");
  });

  test("handles assistant messages with only reasoning (no text)", () => {
    const messages: MessageRow[] = [
      {
        id: "m2",
        sessionId: "s1",
        providerId: "copilot",
        modelId: "gpt-5",
        role: "assistant",
        status: "completed",
        createdAt: "",
        timeCompleted: null,
        tokensIn: null,
        tokensOut: null,
      },
    ];
    const parts: PartRow[] = [
      {
        id: "p3",
        messageId: "m2",
        sessionId: "s1",
        type: "reasoning",
        data: JSON.stringify({ text: "Pure reasoning with no visible text." }),
      },
    ];

    const result = toModelMessages(messages, parts);
    expect(result.length).toBe(1);
    expect(result[0]!.role).toBe("assistant");

    const content = result[0]!.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(1);
    expect(content[0]!.type).toBe("reasoning");
    expect(content[0]!.text).toBe("Pure reasoning with no visible text.");
  });

  test("handles empty reasoning part text", () => {
    const messages: MessageRow[] = [
      {
        id: "m3",
        sessionId: "s1",
        providerId: "copilot",
        modelId: "gpt-5",
        role: "assistant",
        status: "completed",
        createdAt: "",
        timeCompleted: null,
        tokensIn: null,
        tokensOut: null,
      },
    ];
    const parts: PartRow[] = [
      {
        id: "p4",
        messageId: "m3",
        sessionId: "s1",
        type: "reasoning",
        data: JSON.stringify({ text: "" }),
      },
    ];

    const result = toModelMessages(messages, parts);

    // Empty reasoning text filters out the part, produces no assistant content,
    // so no assistant message is emitted at all
    const assistantMessages = result.filter((m) => m.role === "assistant");
    expect(assistantMessages.length).toBe(0);
  });

  test("reasoning preserved alongside tool calls", () => {
    const messages: MessageRow[] = [
      {
        id: "m4",
        sessionId: "s1",
        providerId: "copilot",
        modelId: "gpt-5",
        role: "assistant",
        status: "completed",
        createdAt: "",
        timeCompleted: null,
        tokensIn: null,
        tokensOut: null,
      },
    ];
    const parts: PartRow[] = [
      {
        id: "p5",
        messageId: "m4",
        sessionId: "s1",
        type: "reasoning",
        data: JSON.stringify({ text: "I need to read the file first." }),
      },
      {
        id: "p6",
        messageId: "m4",
        sessionId: "s1",
        type: "tool",
        data: JSON.stringify({
          tool: "read",
          callId: "call-1",
          status: "completed",
          input: { filePath: "/tmp/test" },
          output: "file contents",
        }),
      },
    ];

    const result = toModelMessages(messages, parts);

    // Should produce: 1 assistant message + 1 tool result message
    expect(result.length).toBe(2);
    expect(result[0]!.role).toBe("assistant");
    expect(result[1]!.role).toBe("tool");

    const assistantContent = result[0]!.content as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(assistantContent)).toBe(true);

    // Should have reasoning AND tool-call parts
    const reasoningPart = assistantContent.find((p) => p.type === "reasoning");
    const toolCallPart = assistantContent.find((p) => p.type === "tool-call");

    expect(reasoningPart).toBeDefined();
    expect(reasoningPart!.text).toBe("I need to read the file first.");
    expect(toolCallPart).toBeDefined();
    expect(toolCallPart!.toolName).toBe("read");
  });
});
