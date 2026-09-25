import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSession, createJsonlSessionStore } from "../../packages/runner/src/session/session"
import { reserveLiveTurn, isLiveTurn } from "../../packages/runner/src/session/live-turn"
import { saveUserMessage } from "../../packages/runner/src/session/message"
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
})
