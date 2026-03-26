// Tests for the /new command
//
// Test plan
// ─────────────────────────────────────────────────────────────────
// Scope: two units changed by the /new feature
//   1. src/tui/commands.ts  — /new registered in the command registry
//   2. src/tui/index.tsx    — handleCommand("new") emits session-reset
//                             with a pre-created, non-null session ID
//
// Group 1 – Command registry
//   1a. /new appears in the full command list
//   1b. filterCommands("n")   includes /new
//   1c. filterCommands("ne")  includes /new
//   1d. filterCommands("new") returns exactly /new
//   1e. /new has the expected description
//
// Group 2 – TUI state bridge (/new-specific wireEvents behaviour)
//   The /new handler emits  session-reset { sessionId: "<real-id>" }
//   — i.e. a pre-created, non-null ID.  This is different from /clear
//   (which emits null) and requires no subsequent session-created event.
//
//   2a. session-reset with a real ID switches sessionId immediately
//   2b. session-reset with a real ID clears messages + running state
//   2c. After session-reset with a real ID, events for the new session
//       are processed immediately (createComputed re-wired)
//   2d. After session-reset with a real ID, old session events are ignored
//   2e. Full /new cycle: active session → /new → new session is live,
//       old session events are dead
// ─────────────────────────────────────────────────────────────────

import { describe, test, expect, afterEach } from "bun:test"
import { createRoot } from "solid-js"
import { commands, filterCommands } from "../../src/tui/commands"
import { createAppState } from "../../src/tui/state"
import { wireEvents } from "../../src/tui/events"
import { bus } from "../../src/session/events"

// ── helpers ──────────────────────────────────────────────────────

let dispose: (() => void) | null = null

afterEach(() => {
  bus.removeAllListeners()
  dispose?.()
  dispose = null
})

function setup(sessionId: string | null = "s1") {
  let state!: ReturnType<typeof createAppState>
  createRoot((d) => {
    dispose = d
    state = createAppState({ sessionId, modelName: "smart", skillCount: 0 })
    wireEvents(state)
  })
  return state
}

// ── Group 1: Command registry ─────────────────────────────────────

describe("/new command: registry", () => {
  test("1a. /new appears in the full command list", () => {
    expect(commands.some((c) => c.id === "new")).toBe(true)
  })

  test("1b. filterCommands('n') includes /new", () => {
    const results = filterCommands("n")
    expect(results.some((c) => c.id === "new")).toBe(true)
  })

  test("1c. filterCommands('ne') includes /new", () => {
    const results = filterCommands("ne")
    expect(results.some((c) => c.id === "new")).toBe(true)
  })

  test("1d. filterCommands('new') returns exactly /new", () => {
    const results = filterCommands("new")
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe("new")
  })

  test("1e. /new has a non-empty description", () => {
    const cmd = commands.find((c) => c.id === "new")!
    expect(cmd.description.length).toBeGreaterThan(0)
  })
})

// ── Group 2: TUI state bridge (/new-specific behaviour) ───────────

describe("/new command: wireEvents behaviour", () => {
  test("2a. session-reset with real ID switches sessionId immediately", () => {
    const s = setup("s1")
    expect(s.store.sessionId).toBe("s1")

    bus.emit("session-reset", { sessionId: "s2" })

    expect(s.store.sessionId).toBe("s2")
  })

  test("2b. session-reset with real ID clears messages and running state", () => {
    const s = setup("s1")
    bus.emit("assistant-message-start", { sessionId: "s1", messageId: "m1" })
    bus.emit("loop-start", { sessionId: "s1" })
    expect(s.store.messages.length).toBe(1)
    expect(s.store.running).toBe(true)

    bus.emit("session-reset", { sessionId: "s2" })

    expect(s.store.messages).toEqual([])
    expect(s.store.running).toBe(false)
    expect(s.store.status.tokensUsed).toBe(0)
  })

  test("2c. after session-reset with real ID, new session events are processed immediately", () => {
    const s = setup("s1")

    // /new emits session-reset with the already-created session ID
    bus.emit("session-reset", { sessionId: "s2" })

    // No session-created needed — createComputed re-wired to s2 synchronously
    bus.emit("assistant-message-start", { sessionId: "s2", messageId: "m1" })
    expect(s.store.messages.length).toBe(1)
    expect(s.store.messages[0]!.role).toBe("assistant")
  })

  test("2d. after session-reset with real ID, old session events are ignored", () => {
    const s = setup("s1")

    bus.emit("session-reset", { sessionId: "s2" })

    // s1 events must be silently dropped
    bus.emit("assistant-message-start", { sessionId: "s1", messageId: "m1" })
    expect(s.store.messages.length).toBe(0)
  })

  test("2e. full /new cycle: s1 active → /new (s2) → s2 live, s1 events dead", () => {
    const s = setup("s1")

    // Build up some history in s1
    bus.emit("assistant-message-start", { sessionId: "s1", messageId: "m1" })
    bus.emit("text-start", { sessionId: "s1", messageId: "m1", partId: "p1" })
    bus.emit("text-end", { sessionId: "s1", messageId: "m1", partId: "p1", text: "hello" })
    expect(s.store.messages.length).toBe(1)

    // User runs /new — backend creates a session and emits session-reset
    bus.emit("session-reset", { sessionId: "s2" })
    expect(s.store.sessionId).toBe("s2")
    expect(s.store.messages).toEqual([])

    // s2 receives its first assistant message immediately
    bus.emit("assistant-message-start", { sessionId: "s2", messageId: "m2" })
    expect(s.store.messages.length).toBe(1)

    // Stale s1 event does not leak into s2
    bus.emit("assistant-message-start", { sessionId: "s1", messageId: "m_stale" })
    expect(s.store.messages.length).toBe(1)
  })
})
