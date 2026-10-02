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
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { createJsonlSessionStore } from "../../packages/runner/src/session/session"
import { createRunner, type Runner } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { createSession, listSessions } from "../../packages/runner/src/session/session"

let tmpDir: string
let runner: Runner

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-lazy-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
  runner = createRunner({
    agent: defineAgent({ id: "test", instructions: "test", tools: [], model: "invalid/nonexistent" }),
    store: createJsonlSessionStore(tmpDir),
  })
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  runner.bus.removeAllListeners()
})

describe("lazy session creation: prompt()", () => {
  test("emits session-created with a new sessionId when no sessionId provided", async () => {
    let capturedId: string | null = null
    runner.bus.on("session-created", ({ sessionId }) => {
      capturedId = sessionId
    })

    // prompt() throws at resolveModel (no auth token) — that is expected
    await runner.prompt({ parts: [{ type: "text", text: "hello" }] }).catch(() => {})

    expect(capturedId).not.toBeNull()
    expect(typeof capturedId).toBe("string")
    expect(capturedId!.length).toBeGreaterThan(0)
  })

  test("creates exactly one session row in DB per call without sessionId", async () => {
    const before = listSessions(runner.store).length

    await runner.prompt({ parts: [{ type: "text", text: "hello" }] }).catch(() => {})

    const after = listSessions(runner.store).length
    expect(after).toBe(before + 1)
  })

  test("does NOT emit session-created when an existing sessionId is provided", async () => {
    const existing = createSession(undefined, runner.store)

    let fired = false
    runner.bus.on("session-created", () => {
      fired = true
    })

    await runner.prompt({
      sessionId: existing.id,
      parts: [{ type: "text", text: "resume" }],
    }).catch(() => {})

    expect(fired).toBe(false)
  })

  test("does NOT create an extra session row when resuming an existing session", async () => {
    const existing = createSession(undefined, runner.store)
    const before = listSessions(runner.store).length

    await runner.prompt({
      sessionId: existing.id,
      parts: [{ type: "text", text: "resume" }],
    }).catch(() => {})

    const after = listSessions(runner.store).length
    expect(after).toBe(before) // no new row
  })
})
