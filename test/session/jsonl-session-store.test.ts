// createJsonlSessionStore — a disk-backed store scoped to a caller-owned root.
//
// The default (no root) store is the legacy global JSONL store; passing a root
// namespaces all reads/writes under it so two stores never share history, even
// for the same session ID.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createJsonlSessionStore, createSession } from "../../packages/runner/src/session/session"
import { loadMessages, saveUserMessage } from "../../packages/runner/src/session/message"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quark-jsonl-store-"))
  setSessionStorageRoot(tmp)
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("createJsonlSessionStore — namespace isolation", () => {
  test("two roots never share history for the same session ID", () => {
    const a = createJsonlSessionStore(path.join(tmp, "a"))
    const b = createJsonlSessionStore(path.join(tmp, "b"))
    const id = "shared-id"

    createSession({ id }, a)
    createSession({ id }, b)
    saveUserMessage({ sessionId: id, text: "alpha", store: a })
    saveUserMessage({ sessionId: id, text: "bravo", store: b })

    const texts = (store: typeof a) => loadMessages(id, store).parts.map((p) => JSON.parse(p.data).text)
    expect(texts(a)).toEqual(["alpha"])
    expect(texts(b)).toEqual(["bravo"])
    expect(fs.existsSync(path.join(tmp, "a", id, "session.jsonl"))).toBe(true)
    expect(fs.existsSync(path.join(tmp, "b", id, "session.jsonl"))).toBe(true)
  })

  test("a rooted store is strict: unknown IDs are not implicitly created", () => {
    const store = createJsonlSessionStore(path.join(tmp, "strict"))
    expect(store.createOnMissing).toBe(false)
    expect(store.get("nope")).toBeNull()
  })
})
