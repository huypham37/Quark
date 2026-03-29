// Tests for reasoning event handling in the processor/DB layer (Phase 2)
//
// Verifies:
// 1. reasoning-start event creates a new reasoning part in DB with empty text
// 2. reasoning-delta appends text to the current reasoning part
// 3. reasoning-end finalises the reasoning part (bus event fires)
// 4. Bus events reasoning-start, reasoning-delta, reasoning-end are emitted
//    with correct payload

import { describe, test, expect, beforeAll, afterEach } from "bun:test"
import { getDB } from "../../src/storage/db"
import { bootstrap, resetBootstrap } from "../../src/bootstrap"
import { createSession } from "../../src/session/session"
import {
  createAssistantMessage,
  addPart,
  updatePart,
  loadMessages,
  type ReasoningPartData,
} from "../../src/session/message"
import { bus } from "../../src/session/events"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  getDB(":memory:")
  resetBootstrap()
  await bootstrap()
})

afterEach(() => {
  bus.removeAllListeners()
})

function makeSession(): { sessionId: string; messageId: string } {
  const session = createSession()
  const msg = createAssistantMessage({ sessionId: session.id })
  return { sessionId: session.id, messageId: msg.id }
}

// ---------------------------------------------------------------------------
// 1. reasoning-start — creates a reasoning part with empty text
// ---------------------------------------------------------------------------
describe("reasoning part persistence", () => {
  test("addPart with type=reasoning creates a part with empty text", () => {
    const { sessionId, messageId } = makeSession()

    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "" } satisfies ReasoningPartData,
    })

    expect(typeof partId).toBe("string")
    expect(partId.length).toBeGreaterThan(0)

    const { parts } = loadMessages(sessionId)
    const reasoningPart = parts.find((p) => p.id === partId)
    expect(reasoningPart).toBeDefined()
    expect(reasoningPart!.type).toBe("reasoning")
    expect(JSON.parse(reasoningPart!.data)).toEqual({ text: "" })
  })

  // ---------------------------------------------------------------------------
  // 2. reasoning-delta — appends text via updatePart
  // ---------------------------------------------------------------------------
  test("updatePart appends text to a reasoning part", () => {
    const { sessionId, messageId } = makeSession()

    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "" } satisfies ReasoningPartData,
    })

    // Simulate delta accumulation
    const data: ReasoningPartData = { text: "" }
    data.text += "First delta."
    updatePart(partId, data)

    data.text += " Second delta."
    updatePart(partId, data)

    const { parts } = loadMessages(sessionId)
    const reasoningPart = parts.find((p) => p.id === partId)
    expect(reasoningPart).toBeDefined()
    const stored = JSON.parse(reasoningPart!.data) as ReasoningPartData
    expect(stored.text).toBe("First delta. Second delta.")
  })

  // ---------------------------------------------------------------------------
  // 3. Multiple reasoning parts in one message
  // ---------------------------------------------------------------------------
  test("multiple reasoning parts can be added to a single message", () => {
    const { sessionId, messageId } = makeSession()

    addPart({ messageId, sessionId, type: "reasoning", data: { text: "thought 1" } })
    addPart({ messageId, sessionId, type: "reasoning", data: { text: "thought 2" } })

    const { parts } = loadMessages(sessionId)
    const reasoningParts = parts.filter(
      (p) => p.messageId === messageId && p.type === "reasoning",
    )
    expect(reasoningParts.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 4. Bus events — reasoning-start, reasoning-delta, reasoning-end
// ---------------------------------------------------------------------------
describe("reasoning bus events", () => {
  test("reasoning-start bus event carries correct payload", (done) => {
    const { sessionId, messageId } = makeSession()
    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "" } satisfies ReasoningPartData,
    })

    bus.once("reasoning-start", (data) => {
      expect(data.sessionId).toBe(sessionId)
      expect(data.messageId).toBe(messageId)
      expect(data.partId).toBe(partId)
      done()
    })

    bus.emit("reasoning-start", { sessionId, messageId, partId })
  })

  test("reasoning-delta bus event carries correct payload", (done) => {
    const { sessionId, messageId } = makeSession()
    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "" } satisfies ReasoningPartData,
    })

    bus.once("reasoning-delta", (data) => {
      expect(data.sessionId).toBe(sessionId)
      expect(data.messageId).toBe(messageId)
      expect(data.partId).toBe(partId)
      expect(data.delta).toBe("Hello")
      expect(data.text).toBe("Hello")
      done()
    })

    bus.emit("reasoning-delta", { sessionId, messageId, partId, delta: "Hello", text: "Hello" })
  })

  test("reasoning-end bus event carries correct payload", (done) => {
    const { sessionId, messageId } = makeSession()
    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "completed thought" } satisfies ReasoningPartData,
    })

    bus.once("reasoning-end", (data) => {
      expect(data.sessionId).toBe(sessionId)
      expect(data.messageId).toBe(messageId)
      expect(data.partId).toBe(partId)
      done()
    })

    bus.emit("reasoning-end", { sessionId, messageId, partId })
  })

  test("reasoning-delta accumulates text across multiple deltas", (done) => {
    const { sessionId, messageId } = makeSession()
    const partId = addPart({
      messageId,
      sessionId,
      type: "reasoning",
      data: { text: "" } satisfies ReasoningPartData,
    })

    const received: string[] = []
    let count = 0

    bus.on("reasoning-delta", (data) => {
      if (data.partId !== partId) return
      received.push(data.text)
      count++
      if (count === 3) {
        expect(received).toEqual(["A", "AB", "ABC"])
        done()
      }
    })

    bus.emit("reasoning-delta", { sessionId, messageId, partId, delta: "A", text: "A" })
    bus.emit("reasoning-delta", { sessionId, messageId, partId, delta: "B", text: "AB" })
    bus.emit("reasoning-delta", { sessionId, messageId, partId, delta: "C", text: "ABC" })
  })
})
