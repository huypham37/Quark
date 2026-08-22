import { describe, expect, test } from "bun:test"
import { buildSessionPreview } from "../../src/tui/session-preview"
import type { TuiMessage } from "../../src/tui/state"

describe("session preview", () => {
  test("returns the latest user and assistant text", () => {
    const messages: TuiMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "First question" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "First answer" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Latest\nquestion" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Latest answer" }] },
    ]

    expect(buildSessionPreview(messages)).toEqual({
      user: "Latest question",
      assistant: "Latest answer",
    })
  })
})
