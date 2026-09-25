import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSession, createJsonlSessionStore } from "../../packages/runner/src/session/session"
import { reserveLiveTurn, isLiveTurn, reapStaleTurns } from "../../packages/runner/src/session/live-turn"
import { addPart, createAssistantMessage, saveUserMessage } from "../../packages/runner/src/session/message"
import { TypedBus } from "../../packages/runner/src/session/events"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { followSession } from "../../packages/quark/src/tui/live-viewer"

const root = mkdtempSync(join(tmpdir(), "quark-live-"))
afterEach(() => setSessionStorageRoot(undefined))

describe("cross-process session viewer", () => {
  test("follows events and reconciles completion without duplicate messages", async () => {
    setSessionStorageRoot(root)
    const store = createJsonlSessionStore(root)
    const session = createSession(undefined, store)
    const writer = new TypedBus()
    const viewer = new TypedBus()
    const release = reserveLiveTurn(session.id, root, writer)
    expect(release).not.toBeNull()
    expect(reserveLiveTurn(session.id, root)).toBeNull()
    const switches: Array<{ messages: Array<{ id: string }> }> = []
    const deltas: string[] = []
    const busy: boolean[] = []
    viewer.on("session-switch", (event) => switches.push(event as any))
    viewer.on("text-delta", (event) => deltas.push(event.text))
    const stop = followSession(session.id, viewer, (value) => busy.push(value))
    const user = saveUserMessage({ sessionId: session.id, text: "hello", store })
    writer.emit("user-message", { sessionId: session.id, messageId: user.id, text: "hello" })
    writer.emit("text-delta", { sessionId: session.id, messageId: "assistant", partId: "part", delta: "hi", text: "hi" })
    await Bun.sleep(350)
    expect(deltas).toEqual(["hi"])
    expect(busy).toEqual([true])
    release!()
    await Bun.sleep(350)
    expect(busy).toEqual([true, false])
    expect(switches.at(-1)?.messages.filter((m) => m.id === user.id)).toHaveLength(1)
    expect(isLiveTurn(session.id, root)).toBe(false)
    stop()
  })

  test("coalesces deltas and flushes full text before text-end", () => {
    setSessionStorageRoot(root)
    const store = createJsonlSessionStore(root)
    const session = createSession(undefined, store)
    const writer = new TypedBus()
    const release = reserveLiveTurn(session.id, root, writer)!
    const log = join(root, session.id, "live-events.jsonl")
    let text = ""
    for (let i = 0; i < 500; i++) {
      text += "x"
      writer.emit("text-delta", { sessionId: session.id, messageId: "m", partId: "p", delta: "x", text })
    }
    writer.emit("text-end", { sessionId: session.id, messageId: "m", partId: "p", text })
    const lines = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    const deltas = lines.filter((line) => line.name === "text-delta")
    expect(deltas).toHaveLength(1)
    expect(deltas[0].data.text).toBeUndefined()
    expect(deltas[0].data.delta).toBe(text)
    expect(lines.at(-1).name).toBe("text-end")
    release()
  })

  test("log size is flat in stream duration, not quadratic in message length", async () => {
    setSessionStorageRoot(root)
    const store = createJsonlSessionStore(root)
    const chunks = Array.from({ length: 8 }, () => "0123456789".repeat(25)) // 250 chars each
    const content = chunks.join("")
    const stream = async (gapMs: number): Promise<number> => {
      const session = createSession(undefined, store)
      const writer = new TypedBus()
      const release = reserveLiveTurn(session.id, root, writer)!
      const log = join(root, session.id, "live-events.jsonl")
      let text = ""
      for (const chunk of chunks) {
        text += chunk
        writer.emit("text-delta", { sessionId: session.id, messageId: "m", partId: "p", delta: chunk, text })
        if (gapMs > 0) await Bun.sleep(gapMs)
      }
      writer.emit("text-end", { sessionId: session.id, messageId: "m", partId: "p", text })
      const bytes = statSync(log).size
      release()
      return bytes
    }
    const burst = await stream(0)
    const slow = await stream(250)
    // A long stream must not write the accumulated text once per flush window.
    expect(slow / burst).toBeLessThan(1.8)
    expect(slow).toBeLessThan(content.length * 5)
  })

  test("mid-turn attach seeds reconstruction from persisted partial text", async () => {
    setSessionStorageRoot(root)
    const store = createJsonlSessionStore(root)
    const session = createSession(undefined, store)
    const message = createAssistantMessage({ sessionId: session.id, store })
    const partId = addPart({ messageId: message.id, sessionId: session.id, type: "text", data: { text: "AAA" }, store })

    const viewer = new TypedBus()
    const texts: string[] = []
    viewer.on("text-delta", (event) => texts.push(event.text))
    const stop = followSession(session.id, viewer, () => {})

    const writer = new TypedBus()
    const release = reserveLiveTurn(session.id, root, writer)!
    writer.emit("text-delta", { sessionId: session.id, messageId: message.id, partId, delta: "BBB", text: "AAABBB" })
    await Bun.sleep(350)
    expect(texts).toEqual(["AAABBB"])
    release()
    stop()
  })

  test("reapStaleTurns drops dead logs but keeps history", () => {
    const reapRoot = mkdtempSync(join(tmpdir(), "quark-reap-"))
    try {
      setSessionStorageRoot(reapRoot)
      const store = createJsonlSessionStore(reapRoot)
      const session = createSession(undefined, store)
      const log = join(reapRoot, session.id, "live-events.jsonl")
      writeFileSync(log, "{}\n")
      expect(reapStaleTurns(reapRoot)).toBeGreaterThanOrEqual(1)
      expect(existsSync(log)).toBe(false)
      expect(existsSync(join(reapRoot, session.id, "session.jsonl"))).toBe(true)
    } finally {
      rmSync(reapRoot, { recursive: true, force: true })
    }
  })
})
