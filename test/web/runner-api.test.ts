// Remote runner API tests (web/backend.ts).
//
// Routes are driven through WebBackend.fetch() on a prototype-only instance
// (same trick as test/web/send.test.ts): `runners` is seeded directly with
// createRunner() instances so no provider/network is ever contacted. The
// runner's store/bus/cancel plumbing is real — only execution is faked, via a
// `stream` seam or an injected `execute` (mirrors
// test/session/runner-session-store.test.ts).

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { WebBackend, runnerSessionsRoot } from "../../web/backend"
import { createRunner, type Runner, type RunnerExecute } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { createJsonlSessionStore, createSession, defaultSessionStore } from "../../packages/runner/src/session/session"
import { loadMessages, toModelMessages } from "../../packages/runner/src/session/message"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import type { StreamFn } from "../../packages/runner/src/session/processor"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"

// Keep agent/config resolution off the real home directory; only the
// POST /api/runners test resolves an agent, and it uses the built-in "coder".
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-web-runner-"))
const sessionRoot = path.join(configDir, "session")
const originalConfigDir = process.env.QUARK_CONFIG_DIR

beforeAll(() => {
  process.env.QUARK_CONFIG_DIR = configDir
  setSessionStorageRoot(sessionRoot)
})

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = originalConfigDir
  setSessionStorageRoot(undefined)
  fs.rmSync(configDir, { recursive: true, force: true })
})

const MODEL = "ollama/test-model"

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
          attachment: true,
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

function testAgent() {
  return defineAgent({ id: "web-test", instructions: "test", tools: [], model: MODEL })
}

/** A fake provider stream that finishes immediately (no network). */
function fakeStream(): StreamFn {
  return () => ({
    fullStream: (async function* () {
      yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: "finish" }
    })(),
  })
}

/** A runner whose real prompt path runs against a fake stream (no network). */
function streamRunner(): Runner {
  return createRunner({ agent: testAgent(), stream: fakeStream(), resolve: { providers: {}, catalog: catalog() } })
}

/** A runner that stays in-flight until cancelled, so 409/cancel are testable. */
function hangExecute(): RunnerExecute {
  return (input, ctx) =>
    new Promise((resolve) => {
      const done = () => resolve({ sessionId: input.sessionId ?? "generated" })
      if (ctx.signal.aborted) done()
      else ctx.signal.addEventListener("abort", done, { once: true })
    })
}

function hangingRunner(): Runner {
  return createRunner({ agent: testAgent(), execute: hangExecute() })
}

/**
 * A runner wired like WebBackend.runnerCreate: sessions go to the one shared
 * on-disk namespace, but execution is a fake (no network).
 */
function diskRunner(): Runner {
  return createRunner({
    agent: testAgent(),
    stream: fakeStream(),
    store: createJsonlSessionStore(runnerSessionsRoot()),
    resolve: { providers: {}, catalog: catalog() },
  })
}

/** A hanging runner on the shared namespace (cross-runner 409/cancel tests). */
function hangingDiskRunner(): Runner {
  return createRunner({
    agent: testAgent(),
    execute: hangExecute(),
    store: createJsonlSessionStore(runnerSessionsRoot()),
  })
}

/** A disk runner whose real prompt path captures the system prompt it built. */
function captureSystemRunner(captured: string[]): Runner {
  const stream: StreamFn = (options) => {
    captured.push(
      (options.messages as any[])
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n"),
    )
    return {
      fullStream: (async function* () {
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    }
  }
  return createRunner({
    agent: testAgent(),
    stream,
    store: createJsonlSessionStore(runnerSessionsRoot()),
    resolve: { providers: {}, catalog: catalog() },
  })
}

/** Prototype-only backend: just the fields the runner routes touch. */
function backend(): any {
  const instance: any = Object.create(WebBackend.prototype)
  instance.runners = new Map<string, Runner>()
  instance.activeSessions = new Map<string, Runner>()
  instance.catalog = { catalog: { getModel: () => null } }
  return instance
}

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://test${url}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  })
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function partsOf(view: any): Array<{ type: string; text?: string; mime?: string; data?: string }> {
  return (view.messages ?? []).flatMap((message: any) => message.parts ?? [])
}

describe("POST /api/runners", () => {
  test("mints a runner for a known agent and returns { runnerId }", async () => {
    const api = backend()
    const res = await api.fetch(request("POST", "/api/runners", { agentId: "coder" }))
    expect(res.status).toBe(201)
    const { runnerId } = await res.json()
    expect(typeof runnerId).toBe("string")
    expect(runnerId.length).toBeGreaterThan(0)
    expect(api.runners.has(runnerId)).toBe(true)

    // The minted runner is routable: an unknown session on it is a 404, not a
    // "Unknown runner".
    const missing = await api.fetch(request("GET", `/api/runners/${runnerId}/sessions/nope`))
    expect(missing.status).toBe(404)
  })

  test("rejects an unknown agentId with 404", async () => {
    const res = await backend().fetch(request("POST", "/api/runners", { agentId: "does-not-exist" }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('Agent "does-not-exist" not found')
  })

  test("rejects a malformed body with 400", async () => {
    const res = await backend().fetch(request("POST", "/api/runners", []))
    expect(res.status).toBe(400)
  })

  test("rejects a non-string agentId with 400", async () => {
    const res = await backend().fetch(request("POST", "/api/runners", { agentId: 7 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("agentId must be a non-empty string")
  })

  test("only the exact collection path mints: /api/runners/ is 404", async () => {
    const api = backend()
    const res = await api.fetch(request("POST", "/api/runners/", { agentId: "coder" }))
    expect(res.status).toBe(404)
    expect(api.runners.size).toBe(0)
  })
})

describe("unknown runner", () => {
  for (const [method, url, body] of [
    ["POST", "/api/runners/ghost/session/prompt", { text: "x" }],
    ["GET", "/api/runners/ghost/sessions/s1", undefined],
    ["GET", "/api/runners/ghost/sessions/s1/events", undefined],
    ["POST", "/api/runners/ghost/sessions/s1/cancel", undefined],
    ["DELETE", "/api/runners/ghost", undefined],
  ] as const) {
    test(`${method} ${url} -> 404`, async () => {
      const res = await backend().fetch(request(method, url, body))
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe("Unknown runner: ghost")
    })
  }
})

describe("POST /api/runners/:id/session/prompt", () => {
  test("accepts a message, returns { runnerId, sessionId }, and persists it", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("r1", runner)

    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", { text: "hello runner" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.runnerId).toBe("r1")
    expect(typeof body.sessionId).toBe("string")

    // The 202 is asynchronous: the turn is still running when the response
    // lands, so wait for it to settle before asserting on persisted history.
    await waitFor(() => !runner.isActive(body.sessionId))

    const saved = loadMessages(body.sessionId, runner.store)
    expect(saved.messages.filter((message) => message.role === "user")).toHaveLength(1)

    const view = await (await api.fetch(request("GET", `/api/runners/r1/sessions/${body.sessionId}`))).json()
    expect(view.runnerId).toBe("r1")
    expect(partsOf(view).some((part) => part.type === "text" && part.text === "hello runner")).toBe(true)
  })

  test("returns the 202 contract status", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", { text: "hi" }))
    expect(res.status).toBe(202)
  })

  test("resumes an explicit sessionId", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("r1", runner)

    await api.fetch(request("POST", "/api/runners/r1/session/prompt", { sessionId: "resume-me", text: "one" }))
    // A second send while the first turn is active is a 409, so wait for it to
    // finish before resuming the same session.
    await waitFor(() => !runner.isActive("resume-me"))
    await api.fetch(request("POST", "/api/runners/r1/session/prompt", { sessionId: "resume-me", text: "two" }))
    await waitFor(() => !runner.isActive("resume-me"))

    const saved = loadMessages("resume-me", runner.store)
    const texts = saved.parts.filter((part) => part.type === "text").map((part) => JSON.parse(part.data).text)
    expect(texts).toEqual(["one", "two"])
  })

  test("rejects malformed JSON with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", "{not json"))
    expect(res.status).toBe(400)
  })

  test("rejects missing text with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", {}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Message text is required")
  })

  test("rejects a bad image with 400 naming the index", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const body = { text: "x", images: [{ mime: "image/svg+xml", data: "AAAA" }] }
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("images[0]")
  })

  test("rejects an oversized declared body with 413", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(
      request("POST", "/api/runners/r1/session/prompt", "{", { "content-length": String(20 * 1024 * 1024) }),
    )
    expect(res.status).toBe(413)
  })

  test("rejects a blank sessionId with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", { sessionId: "   ", text: "x" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("sessionId must be a non-empty string")
  })

  test("rejects a second in-flight message for the same session with 409", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("dup", runner)

    const first = runner.prompt({ sessionId: "busy", parts: [{ type: "text", text: "first" }] })
    await waitFor(() => runner.isActive("busy"))

    const res = await api.fetch(request("POST", "/api/runners/dup/session/prompt", { sessionId: "busy", text: "again" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("This session is already running")

    runner.cancel("busy")
    await first
    expect(runner.isActive("busy")).toBe(false)
  })
  test("rejects a duplicate send while this endpoint's own turn runs with 409", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("dup", runner)

    const first = await api.fetch(request("POST", "/api/runners/dup/session/prompt", { sessionId: "busy", text: "first" }))
    expect(first.status).toBe(202)
    expect(runner.isActive("busy")).toBe(true)

    const res = await api.fetch(request("POST", "/api/runners/dup/session/prompt", { sessionId: "busy", text: "again" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("This session is already running")

    runner.cancel("busy")
    await waitFor(() => !runner.isActive("busy"))
  })
})

describe("image attachments", () => {
  test("persists a model-visible image part", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("r1", runner)

    const image = { mime: "image/png", data: "iVBORw0KGgo=" }
    const res = await api.fetch(request("POST", "/api/runners/r1/session/prompt", { text: "see this", images: [image] }))
    expect(res.status).toBe(202)
    const { sessionId } = await res.json()
    await waitFor(() => !runner.isActive(sessionId))

    const saved = loadMessages(sessionId, runner.store)
    const imagePart = saved.parts.find((part) => part.type === "image")
    expect(imagePart).toBeDefined()
    expect(JSON.parse(imagePart!.data)).toEqual(image)

    const modelMessages = toModelMessages(saved.messages, saved.parts)
    expect(modelMessages.some((message: any) => message.role === "user" && Array.isArray(message.content) &&
      message.content.some((part: any) => part.type === "image" && part.image === image.data && part.mimeType === image.mime))).toBe(true)
  })
})

describe("shared runner sessions", () => {
  test("a new runner resumes a session created by another runner", async () => {
    const api = backend()
    const a = diskRunner()
    const b = diskRunner()
    api.runners.set("a", a)
    api.runners.set("b", b)
    const shared = "shared-resume"

    await api.fetch(request("POST", "/api/runners/a/session/prompt", { sessionId: shared, text: "alpha" }))
    await waitFor(() => !a.isActive(shared))
    await api.fetch(request("POST", "/api/runners/b/session/prompt", { sessionId: shared, text: "bravo" }))
    await waitFor(() => !b.isActive(shared))

    // b continues the history a started rather than beginning an empty one.
    const texts = loadMessages(shared, b.store).parts.filter((p) => p.type === "text").map((p) => JSON.parse(p.data).text)
    expect(texts).toEqual(["alpha", "bravo"])
  })

  test("concurrent runs on one session across runners are refused with 409", async () => {
    const api = backend()
    const a = hangingDiskRunner()
    const b = diskRunner()
    api.runners.set("a", a)
    api.runners.set("b", b)
    const shared = "shared-busy"

    const first = await api.fetch(request("POST", "/api/runners/a/session/prompt", { sessionId: shared, text: "one" }))
    expect(first.status).toBe(202)
    await waitFor(() => a.isActive(shared))

    // b shares the session namespace, so it must not start a second turn.
    const conflict = await api.fetch(request("POST", "/api/runners/b/session/prompt", { sessionId: shared, text: "two" }))
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toBe("This session is already running")

    // Cancelling through b still reaches the runner actually running the turn.
    const cancel = await api.fetch(request("POST", `/api/runners/b/sessions/${shared}/cancel`))
    expect(cancel.status).toBe(200)
    await waitFor(() => !a.isActive(shared))

    // The run was aborted cleanly, so b can now resume the same session.
    const after = await api.fetch(request("POST", "/api/runners/b/session/prompt", { sessionId: shared, text: "three" }))
    expect(after.status).toBe(202)
    await waitFor(() => !b.isActive(shared))
    const view = await (await api.fetch(request("GET", `/api/runners/b/sessions/${shared}`))).json()
    expect(partsOf(view).some((part) => part.type === "text" && part.text === "three")).toBe(true)
  })

  test("reports running:true through a runner that does not own the active turn", async () => {
    const api = backend()
    const a = hangingDiskRunner()
    const b = diskRunner()
    api.runners.set("a", a)
    api.runners.set("b", b)
    const shared = "shared-running"

    const first = await api.fetch(request("POST", "/api/runners/a/session/prompt", { sessionId: shared, text: "one" }))
    expect(first.status).toBe(202)
    await waitFor(() => a.isActive(shared))

    // b shares the namespace but owns no turn: the session is still running, so
    // its view must agree with what cancel/events would address on b's path.
    const view = await (await api.fetch(request("GET", `/api/runners/b/sessions/${shared}`))).json()
    expect(view.session.running).toBe(true)

    await api.fetch(request("POST", `/api/runners/b/sessions/${shared}/cancel`))
    await waitFor(() => !a.isActive(shared))

    const after = await (await api.fetch(request("GET", `/api/runners/b/sessions/${shared}`))).json()
    expect(after.session.running).toBe(false)
  })
})

describe("persistent runner sessions", () => {
  test("persists under the shared namespace, off the legacy store", async () => {
    const api = backend()
    const runner = diskRunner()
    api.runners.set("disk-a", runner)

    const res = await api.fetch(request("POST", "/api/runners/disk-a/session/prompt", { sessionId: "disk-sess", text: "persist me" }))
    expect(res.status).toBe(202)
    await waitFor(() => !runner.isActive("disk-sess"))

    expect(fs.existsSync(path.join(runnerSessionsRoot(), "disk-sess", "session.jsonl"))).toBe(true)
    // The legacy /api/sessions store never sees a remote runner's session.
    expect(defaultSessionStore.get("disk-sess")).toBeNull()
  })

  test("deleting a runner keeps its sessions for the next runner", async () => {
    const api = backend()
    const first = diskRunner()
    api.runners.set("disk-del", first)

    await api.fetch(request("POST", "/api/runners/disk-del/session/prompt", { sessionId: "kept", text: "one" }))
    await waitFor(() => !first.isActive("kept"))
    expect(fs.existsSync(path.join(runnerSessionsRoot(), "kept", "session.jsonl"))).toBe(true)

    const del = await api.fetch(request("DELETE", "/api/runners/disk-del"))
    expect(del.status).toBe(200)
    // Delete drops the execution handle, not the history.
    expect(fs.existsSync(path.join(runnerSessionsRoot(), "kept", "session.jsonl"))).toBe(true)

    // A brand-new runner (as after a restart) resumes the same session.
    const second = diskRunner()
    api.runners.set("disk-new", second)
    await api.fetch(request("POST", "/api/runners/disk-new/session/prompt", { sessionId: "kept", text: "two" }))
    await waitFor(() => !second.isActive("kept"))

    const texts = loadMessages("kept", second.store).parts.filter((p) => p.type === "text").map((p) => JSON.parse(p.data).text)
    expect(texts).toEqual(["one", "two"])
  })
})

describe("targetWorkspace", () => {
  function workspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "quark-ws-"))
  }

  test("binds a new session to an absolute existing directory and runs in it", async () => {
    const api = backend()
    const captured: string[] = []
    const runner = captureSystemRunner(captured)
    api.runners.set("ws", runner)
    const ws = workspace()

    try {
      const res = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { text: "hi", targetWorkspace: ws }))
      expect(res.status).toBe(202)
      const { sessionId } = await res.json()
      await waitFor(() => !runner.isActive(sessionId))

      expect(runner.store.get(sessionId)!.directory).toBe(path.resolve(ws))
      expect(captured[0]).toContain(`Working directory: ${path.resolve(ws)}`)

      const view = await (await api.fetch(request("GET", `/api/runners/ws/sessions/${sessionId}`))).json()
      expect(view.session.directory).toBe(path.resolve(ws))
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  test("rejects a relative path with 400", async () => {
    const api = backend()
    api.runners.set("ws", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { text: "x", targetWorkspace: "relative/dir" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("absolute")
  })

  test("rejects a missing directory with 400", async () => {
    const api = backend()
    api.runners.set("ws", streamRunner())
    const missing = path.join(os.tmpdir(), `quark-ws-missing-${Date.now()}`)
    const res = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { text: "x", targetWorkspace: missing }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("does not exist")
  })

  test("rejects a file with 400", async () => {
    const ws = workspace()
    try {
      const file = path.join(ws, "not-a-dir.txt")
      fs.writeFileSync(file, "x")
      const api = backend()
      api.runners.set("ws", streamRunner())
      const res = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { text: "x", targetWorkspace: file }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain("not a directory")
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  test("resume keeps the stored workspace and refuses a different one with 409", async () => {
    const api = backend()
    const runner = diskRunner()
    api.runners.set("ws", runner)
    const a = workspace()
    const b = workspace()

    try {
      const first = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { sessionId: "ws-bound", text: "one", targetWorkspace: a }))
      expect(first.status).toBe(202)
      await waitFor(() => !runner.isActive("ws-bound"))

      const conflict = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { sessionId: "ws-bound", text: "two", targetWorkspace: b }))
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).error).toContain("already bound")

      // Resuming with no workspace named continues in the stored one.
      const resumed = await api.fetch(request("POST", "/api/runners/ws/session/prompt", { sessionId: "ws-bound", text: "three" }))
      expect(resumed.status).toBe(202)
      await waitFor(() => !runner.isActive("ws-bound"))

      expect(runner.store.get("ws-bound")!.directory).toBe(path.resolve(a))
    } finally {
      fs.rmSync(a, { recursive: true, force: true })
      fs.rmSync(b, { recursive: true, force: true })
    }
  })
})

describe("session id path safety", () => {
  test("rejects a traversal session id in the prompt body with 400", async () => {
    const api = backend()
    api.runners.set("safe", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/safe/session/prompt", { sessionId: "../escape", text: "x" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("sessionId")
  })

  test("rejects a traversal session id in the session path with 400", async () => {
    const api = backend()
    api.runners.set("safe", streamRunner())
    const res = await api.fetch(request("GET", "/api/runners/safe/sessions/..%2Fescape"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid session id")
  })
})

describe("POST /api/runners/:id/sessions/:sessionId/cancel", () => {
  test("aborts the in-flight turn and reports { cancelled: true }", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("c", runner)
    const sessionId = createSession(undefined, runner.store).id

    const send = api.fetch(request("POST", "/api/runners/c/session/prompt", { sessionId, text: "stop me" }))
    await waitFor(() => runner.isActive(sessionId))

    const res = await api.fetch(request("POST", `/api/runners/c/sessions/${sessionId}/cancel`))
    expect(res.status).toBe(200)
    expect((await res.json()).cancelled).toBe(true)

    const sent = await send
    expect(sent.ok).toBe(true)
    expect(runner.isActive(sessionId)).toBe(false)
  })
})

describe("GET /api/runners/:id/sessions/:sessionId/events", () => {
  test("streams SSE from the runner's own bus", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("e", runner)
    const sessionId = createSession(undefined, runner.store).id

    const res = await api.fetch(request("GET", `/api/runners/e/sessions/${sessionId}/events`))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain("connected")

    runner.bus.emit("text-delta", { sessionId, messageId: "m", partId: "p", delta: "hi", text: "hi" })
    expect(decoder.decode((await reader.read()).value)).toContain("text-delta")

    await reader.cancel()
  })

  test("404s for an unknown session on a known runner", async () => {
    const api = backend()
    api.runners.set("e", streamRunner())
    const res = await api.fetch(request("GET", "/api/runners/e/sessions/nope/events"))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Session not found")
  })
})

describe("DELETE /api/runners/:id", () => {
  test("removes the runner", async () => {
    const api = backend()
    api.runners.set("d", streamRunner())

    const res = await api.fetch(request("DELETE", "/api/runners/d"))
    expect(res.ok).toBe(true)

    const after = await api.fetch(request("GET", "/api/runners/d/sessions/whatever"))
    expect(after.status).toBe(404)
    expect((await after.json()).error).toBe("Unknown runner: d")
  })

  test("refuses to delete while a turn is in flight with 409", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("busy", runner)

    const send = await api.fetch(request("POST", "/api/runners/busy/session/prompt", { text: "long" }))
    expect(send.status).toBe(202)
    const { sessionId } = await send.json()

    const res = await api.fetch(request("DELETE", "/api/runners/busy"))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("active run")

    // Cancel the turn, then the delete goes through.
    await api.fetch(request("POST", `/api/runners/busy/sessions/${sessionId}/cancel`))
    await waitFor(() => !runner.isActive(sessionId))

    const after = await api.fetch(request("DELETE", "/api/runners/busy"))
    expect(after.status).toBe(200)
    expect(api.runners.has("busy")).toBe(false)
  })
})
