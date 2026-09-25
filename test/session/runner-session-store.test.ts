// Instance-scoped session persistence.
//
// createRunner() + AgentDefinition defaults to an in-memory SessionStore, so:
//   1. two runners can reuse the SAME session ID and never see each other's
//      message history;
//   2. nothing is written under the session storage root (no ~/.config/quark).
//
// The model call is faked via the `stream` seam — no network.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineAgent } from "../../packages/runner/src/agent"
import { createRunner } from "../../packages/runner/src/runner"
import { defaultSessionStore, createSession, getSession } from "../../packages/runner/src/session/session"
import { loadMessages, saveUserMessage } from "../../packages/runner/src/session/message"
import { MemorySessionStore } from "../../packages/runner/src/session/store"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { bus as legacyBus } from "../../packages/runner/src/session/events"
import type { StreamFn } from "../../packages/runner/src/session/processor"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"

const MODEL = "ollama/test-model"
const SHARED = "shared-session-id"

// Deliberately never created: any disk write on the portable path fails this.
let storageRoot: string

beforeAll(() => {
  storageRoot = join(mkdtempSync(join(tmpdir(), "quark-nodisk-")), "session-root")
  setSessionStorageRoot(storageRoot)
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
})

afterEach(() => {
  legacyBus.removeAllListeners()
  delete process.env.QUARK_SESSION_ID
})

function catalog(): CatalogRegistry {
  return new CatalogRegistry(createCatalogSnapshot({
    ollama: {
      id: "ollama",
      name: "Ollama",
      npm: "@ollama/ai",
      env: ["OLLAMA_API_KEY"],
      doc: "https://ollama.example/docs",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          description: "offline test model",
          attachment: false,
          reasoning: false,
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 100_000, output: 4_000 },
        },
      },
    },
  }, { fetchedAt: 1 }))
}

/** Captures the non-system messages each model call received. */
function captureStream() {
  const calls: string[] = []
  const stream: StreamFn = (options) => {
    calls.push(
      (options.messages as any[])
        .filter((m) => m.role !== "system")
        .map((m) => JSON.stringify(m.content))
        .join("\n"),
    )
    return {
      fullStream: (async function* () {
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    }
  }
  return { calls, stream }
}

function portable(id: string) {
  return defineAgent({ id, instructions: `${id} instructions`, tools: [], model: MODEL })
}

describe("createRunner — instance-scoped session history", () => {
  test("two runners with the same session ID keep different histories", async () => {
    const a = captureStream()
    const b = captureStream()
    const runnerA = createRunner({ agent: portable("agent-a"), stream: a.stream })
    const runnerB = createRunner({ agent: portable("agent-b"), stream: b.stream })

    const turn = (text: string) => [{ type: "text" as const, text }]

    await runnerA.prompt({ sessionId: SHARED, parts: turn("alpha one"), catalog: catalog() })
    await runnerB.prompt({ sessionId: SHARED, parts: turn("bravo one"), catalog: catalog() })
    await runnerA.prompt({ sessionId: SHARED, parts: turn("alpha two"), catalog: catalog() })
    await runnerB.prompt({ sessionId: SHARED, parts: turn("bravo two"), catalog: catalog() })

    // Second call on each runner replayed only its own first turn.
    expect(a.calls[1]).toContain("alpha one")
    expect(a.calls[1]).toContain("alpha two")
    expect(a.calls[1]).not.toContain("bravo")

    expect(b.calls[1]).toContain("bravo one")
    expect(b.calls[1]).toContain("bravo two")
    expect(b.calls[1]).not.toContain("alpha")

    // Distinct stores, both holding the same ID.
    expect(runnerA.store).not.toBe(runnerB.store)
    expect(runnerA.store.get(SHARED)?.id).toBe(SHARED)
    expect(runnerB.store.get(SHARED)?.id).toBe(SHARED)

    // The global JSONL store never saw this session.
    expect(() => getSession(SHARED)).toThrow(/Session not found/)
  })

  test("portable runs write nothing under the session storage root", () => {
    expect(existsSync(storageRoot)).toBe(false)
  })
})

describe("SessionStore defaults", () => {
  test("portable runner defaults to an in-memory store; legacy store requires explicit creation", () => {
    const runner = createRunner({ agent: portable("mem") })
    expect(runner.store).toBeInstanceOf(MemorySessionStore)
    expect(runner.store.createOnMissing).toBe(true)
    expect(defaultSessionStore.createOnMissing).toBe(false)
  })

  test("MemorySessionStore round-trips messages without disk", () => {
    const store = new MemorySessionStore()
    const session = createSession(undefined, store).id
    saveUserMessage({ sessionId: session, text: "hello memory", store })

    const { messages, parts } = loadMessages(session, store)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe("user")
    expect(parts).toHaveLength(1)
    expect(JSON.parse(parts[0]!.data).text).toBe("hello memory")
  })
})

describe("MemorySessionStore — supplied-ID creation is announced", () => {
  test("createOnMissing emits session-created and fires session.created once", async () => {
    const created: string[] = []
    const hookFired: string[] = []
    const runner = createRunner({
      agent: portable("announced"),
      stream: captureStream().stream,
      hooks: {
        "session.created": async ({ sessionId }) => { hookFired.push(sessionId) },
      },
    })
    runner.bus.on("session-created", ({ sessionId }) => created.push(sessionId))

    const id = "supplied-new-session"
    await runner.prompt({ sessionId: id, parts: [{ type: "text", text: "hi" }], catalog: catalog() })

    expect(created).toEqual([id])
    expect(hookFired).toEqual([id])
  })

  test("a generated ID is announced exactly once", async () => {
    const created: string[] = []
    const hookFired: string[] = []
    const runner = createRunner({
      agent: portable("generated"),
      stream: captureStream().stream,
      hooks: { "session.created": async ({ sessionId }) => { hookFired.push(sessionId) } },
    })
    runner.bus.on("session-created", ({ sessionId }) => created.push(sessionId))

    const { sessionId } = await runner.prompt({ parts: [{ type: "text", text: "hi" }], catalog: catalog() })

    expect(created).toEqual([sessionId])
    expect(hookFired).toEqual([sessionId])
  })

  test("an existing session is not re-announced", async () => {
    const created: string[] = []
    const runner = createRunner({ agent: portable("existing"), stream: captureStream().stream })
    runner.bus.on("session-created", ({ sessionId }) => created.push(sessionId))

    const id = "existing-session"
    await runner.prompt({ sessionId: id, parts: [{ type: "text", text: "one" }], catalog: catalog() })
    await runner.prompt({ sessionId: id, parts: [{ type: "text", text: "two" }], catalog: catalog() })

    expect(created).toEqual([id])
  })
})

describe("MemorySessionStore returns detached copies", () => {
  test("get, replay, and list never expose internal envelopes or filesModified", () => {
    const store = new MemorySessionStore()
    const session = createSession({ filesModified: ["a.ts"] }, store)

    const got = store.get(session.id)!
    got.title = "mutated"
    got.filesModified!.push("b.ts")
    expect(store.get(session.id)!.title).toBeNull()
    expect(store.get(session.id)!.filesModified).toEqual(["a.ts"])

    const replayed = store.replay(session.id).session!
    replayed.filesModified!.push("c.ts")
    expect(store.get(session.id)!.filesModified).toEqual(["a.ts"])

    const listed = store.list()[0]!
    listed.filesModified!.push("d.ts")
    expect(store.get(session.id)!.filesModified).toEqual(["a.ts"])
  })
})
