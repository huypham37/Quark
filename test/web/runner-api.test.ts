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
import { WebBackend } from "../../web/backend"
import { createRunner, type Runner, type RunnerExecute } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { createSession } from "../../packages/runner/src/session/session"
import { loadMessages, toModelMessages } from "../../packages/runner/src/session/message"
import type { StreamFn } from "../../packages/runner/src/session/processor"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"

// Keep agent/config resolution off the real home directory; only the
// POST /api/runners test resolves an agent, and it uses the built-in "coder".
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-web-runner-"))
const originalConfigDir = process.env.QUARK_CONFIG_DIR

beforeAll(() => {
  process.env.QUARK_CONFIG_DIR = configDir
})

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = originalConfigDir
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

/** A runner whose real prompt path runs against a fake stream (no network). */
function streamRunner(): Runner {
  const stream: StreamFn = () => ({
    fullStream: (async function* () {
      yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: "finish" }
    })(),
  })
  return createRunner({ agent: testAgent(), stream, resolve: { providers: {}, catalog: catalog() } })
}

/** A runner that stays in-flight until cancelled, so 409/cancel are testable. */
function hangingRunner(): Runner {
  const execute: RunnerExecute = (input, ctx) =>
    new Promise((resolve) => {
      const done = () => resolve({ sessionId: input.sessionId ?? "generated" })
      if (ctx.signal.aborted) done()
      else ctx.signal.addEventListener("abort", done, { once: true })
    })
  return createRunner({ agent: testAgent(), execute })
}

/** Prototype-only backend: just the fields the runner routes touch. */
function backend(): any {
  const instance: any = Object.create(WebBackend.prototype)
  instance.runners = new Map<string, Runner>()
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
    ["POST", "/api/runners/ghost/messages", { text: "x" }],
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

describe("POST /api/runners/:id/messages", () => {
  test("accepts a message, returns { runnerId, sessionId }, and persists it", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("r1", runner)

    const res = await api.fetch(request("POST", "/api/runners/r1/messages", { text: "hello runner" }))
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
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", { text: "hi" }))
    expect(res.status).toBe(202)
  })

  test("resumes an explicit sessionId", async () => {
    const api = backend()
    const runner = streamRunner()
    api.runners.set("r1", runner)

    await api.fetch(request("POST", "/api/runners/r1/messages", { sessionId: "resume-me", text: "one" }))
    // A second send while the first turn is active is a 409, so wait for it to
    // finish before resuming the same session.
    await waitFor(() => !runner.isActive("resume-me"))
    await api.fetch(request("POST", "/api/runners/r1/messages", { sessionId: "resume-me", text: "two" }))
    await waitFor(() => !runner.isActive("resume-me"))

    const saved = loadMessages("resume-me", runner.store)
    const texts = saved.parts.filter((part) => part.type === "text").map((part) => JSON.parse(part.data).text)
    expect(texts).toEqual(["one", "two"])
  })

  test("rejects malformed JSON with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", "{not json"))
    expect(res.status).toBe(400)
  })

  test("rejects missing text with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", {}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Message text is required")
  })

  test("rejects a bad image with 400 naming the index", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const body = { text: "x", images: [{ mime: "image/svg+xml", data: "AAAA" }] }
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("images[0]")
  })

  test("rejects an oversized declared body with 413", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(
      request("POST", "/api/runners/r1/messages", "{", { "content-length": String(20 * 1024 * 1024) }),
    )
    expect(res.status).toBe(413)
  })

  test("rejects a blank sessionId with 400", async () => {
    const api = backend()
    api.runners.set("r1", streamRunner())
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", { sessionId: "   ", text: "x" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("sessionId must be a non-empty string")
  })

  test("rejects a second in-flight message for the same session with 409", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("dup", runner)

    const first = runner.prompt({ sessionId: "busy", parts: [{ type: "text", text: "first" }] })
    await waitFor(() => runner.isActive("busy"))

    const res = await api.fetch(request("POST", "/api/runners/dup/messages", { sessionId: "busy", text: "again" }))
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

    const first = await api.fetch(request("POST", "/api/runners/dup/messages", { sessionId: "busy", text: "first" }))
    expect(first.status).toBe(202)
    expect(runner.isActive("busy")).toBe(true)

    const res = await api.fetch(request("POST", "/api/runners/dup/messages", { sessionId: "busy", text: "again" }))
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
    const res = await api.fetch(request("POST", "/api/runners/r1/messages", { text: "see this", images: [image] }))
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

describe("session isolation", () => {
  test("two runners reuse the same explicit sessionId without sharing history", async () => {
    const api = backend()
    const a = streamRunner()
    const b = streamRunner()
    api.runners.set("a", a)
    api.runners.set("b", b)
    const shared = "shared-session-id"

    await api.fetch(request("POST", "/api/runners/a/messages", { sessionId: shared, text: "alpha one" }))
    await api.fetch(request("POST", "/api/runners/b/messages", { sessionId: shared, text: "bravo one" }))
    await waitFor(() => !a.isActive(shared) && !b.isActive(shared))

    expect(a.store).not.toBe(b.store)
    expect(loadMessages(shared, a.store).messages.filter((message) => message.role === "user")).toHaveLength(1)
    expect(loadMessages(shared, b.store).messages.filter((message) => message.role === "user")).toHaveLength(1)

    const aView = await (await api.fetch(request("GET", `/api/runners/a/sessions/${shared}`))).json()
    const bView = await (await api.fetch(request("GET", `/api/runners/b/sessions/${shared}`))).json()
    const aText = partsOf(aView).filter((part) => part.type === "text").map((part) => part.text)
    const bText = partsOf(bView).filter((part) => part.type === "text").map((part) => part.text)

    expect(aText).toContain("alpha one")
    expect(aText).not.toContain("bravo one")
    expect(bText).toContain("bravo one")
    expect(bText).not.toContain("alpha one")
  })
})

describe("POST /api/runners/:id/sessions/:sessionId/cancel", () => {
  test("aborts the in-flight turn and reports { cancelled: true }", async () => {
    const api = backend()
    const runner = hangingRunner()
    api.runners.set("c", runner)
    const sessionId = createSession(undefined, runner.store).id

    const send = api.fetch(request("POST", "/api/runners/c/messages", { sessionId, text: "stop me" }))
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

    const send = await api.fetch(request("POST", "/api/runners/busy/messages", { text: "long" }))
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
