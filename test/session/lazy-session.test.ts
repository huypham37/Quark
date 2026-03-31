// Lazy session creation — unit tests
//
// Verifies that prompt() only creates a session when called without an
// existing sessionId, and that it broadcasts the session-created event so the
// TUI can update its state.
//
// Storage is initialised with a temp JSONL directory so no files are touched.
// prompt() will always throw at resolveModel() (no auth token in tests), but
// session-created is emitted synchronously BEFORE loop() is awaited, so the
// assertion is still reachable by catching the expected error.

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { prompt } from "../../src/session/prompt"
import { createSession, listSessions } from "../../src/session/session"
import { bus } from "../../src/session/events"
import { bootstrap, resetBootstrap } from "../../src/bootstrap"

let tmpDir: string

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-lazy-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
  resetBootstrap()
  await bootstrap()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  bus.removeAllListeners()
})

describe("lazy session creation: prompt()", () => {
  test("emits session-created with a new sessionId when no sessionId provided", async () => {
    let capturedId: string | null = null
    bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    // prompt() throws at resolveModel (no auth token) — that is expected
    await prompt({ parts: [{ type: "text", text: "hello" }] }).catch(() => {})

    expect(capturedId).not.toBeNull()
    expect(typeof capturedId).toBe("string")
    expect(capturedId!.length).toBeGreaterThan(0)
  })

  test("creates exactly one session row in DB per call without sessionId", async () => {
    const before = listSessions().length

    await prompt({ parts: [{ type: "text", text: "hello" }] }).catch(() => {})

    const after = listSessions().length
    expect(after).toBe(before + 1)
  })

  test("does NOT emit session-created when an existing sessionId is provided", async () => {
    const existing = createSession()

    let fired = false
    bus.on("session-created", () => {
      fired = true
    })

    await prompt({
      sessionId: existing.id,
      parts: [{ type: "text", text: "resume" }],
    }).catch(() => {})

    expect(fired).toBe(false)
  })

  test("does NOT create an extra session row when resuming an existing session", async () => {
    const existing = createSession()
    const before = listSessions().length

    await prompt({
      sessionId: existing.id,
      parts: [{ type: "text", text: "resume" }],
    }).catch(() => {})

    const after = listSessions().length
    expect(after).toBe(before) // no new row
  })
})
