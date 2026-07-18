import { describe, expect, test } from "bun:test"
import { TypedBus } from "../../src/session/events"
import { createGhosttyTitleController, formatTerminalTitle, isGhostty, sanitizeTerminalTitle } from "../../src/tui/ghostty-title"

describe("Ghostty terminal title", () => {
  test("detects Ghostty only for interactive terminals", () => {
    expect(isGhostty({ TERM: "xterm-ghostty" }, true)).toBe(true)
    expect(isGhostty({ TERM_PROGRAM: "Ghostty" }, true)).toBe(true)
    expect(isGhostty({ TERM: "xterm-ghostty" }, false)).toBe(false)
    expect(isGhostty({ TERM_PROGRAM: "iTerm.app" }, true)).toBe(false)
  })

  test("sanitizes OSC control characters while retaining Unicode", () => {
    expect(sanitizeTerminalTitle("Fix\x1b]2;injected\x07\n— auth")).toBe("Fix ]2;injected — auth")
    expect(formatTerminalTitle("\u202eAuth", "working")).toBe("Quark · Auth · working")
  })

  test("tracks the visible session title and agent status", () => {
    const bus = new TypedBus()
    const titles: string[] = []
    const controller = createGhosttyTitleController({
      bus,
      renderer: { setTerminalTitle: (title) => titles.push(title) },
      getSession: () => ({ title: "Initial task" }),
      initialSessionId: "session-1",
      enabled: true,
    })

    bus.emit("loop-start", { sessionId: "session-1" })
    bus.emit("assistant-message-end", { sessionId: "session-1", messageId: "a", userMessageId: "u", finish: "tool-calls" })
    bus.emit("assistant-message-end", { sessionId: "session-1", messageId: "a", userMessageId: "u", finish: "stop" })
    bus.emit("session-title-changed", { sessionId: "session-1", title: "Refined task" })
    bus.emit("error", { sessionId: "other", error: new Error("ignored") })

    expect(titles).toEqual([
      "Quark · Initial task · idle",
      "Quark · Initial task · working",
      "Quark · Initial task · worked",
      "Quark · Refined task · worked",
    ])
    controller.dispose()
  })
})
