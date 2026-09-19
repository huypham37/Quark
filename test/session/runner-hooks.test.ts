// Portable runner hooks — explicit, instance-scoped, and never global.
//
// createRunner() owns a hook registry: hooks passed via `hooks`/`plugins` stay
// isolated to that runner (same hook name, different handlers), and the
// process-global registry that the filesystem plugin loader populates is never
// consulted on the runner path.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { defineAgent } from "../../packages/runner/src/agent"
import { createRunner } from "../../packages/runner/src/runner"
import { createSession, setSessionTitle } from "../../packages/runner/src/session/session"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import { defineTool } from "../../packages/runner/src/tool/tool"
import { bus as legacyBus } from "../../packages/runner/src/session/events"
import { clearHooks, registerHook } from "../../packages/runner/src/plugin/registry"
import type { StreamFn } from "../../packages/runner/src/session/processor"

const MODEL = "ollama/test-model"

let storageRoot: string

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "quark-test-runner-hooks-"))
  setSessionStorageRoot(storageRoot)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
})

afterEach(() => {
  clearHooks()
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

/** Stream seam that captures the tool set the loop actually built. */
function captureStream() {
  const captured: { tools: Record<string, any> }[] = []
  const stream: StreamFn = (options) => {
    captured.push({ tools: options.tools })
    return {
      fullStream: (async function* () {
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    }
  }
  return { captured, stream }
}

function portableAgent(id: string, tools: ReturnType<typeof defineTool>[] = []) {
  return defineAgent({ id, instructions: `${id} instructions`, tools, model: MODEL })
}

function titledSession(): string {
  const session = createSession()
  setSessionTitle(session.id, "test session")
  return session.id
}

const text = [{ type: "text" as const, text: "hi" }]

describe("runner hooks — process-global suppression", () => {
  test("a portable runner fires its own hooks and never the global registry", async () => {
    const global: string[] = []
    registerHook("provider.request.before", async () => { global.push("provider") })
    registerHook("loop.step.before", async () => { global.push("loop") })
    registerHook("session.created", async () => { global.push("created") })
    registerHook("session.idle", async () => { global.push("idle") })

    const own: string[] = []
    const cap = captureStream()
    const runner = createRunner({
      agent: portableAgent("hooked"),
      stream: cap.stream,
      hooks: {
        "provider.request.before": async () => { own.push("provider") },
        "loop.step.before": async () => { own.push("loop") },
        "session.created": async () => { own.push("created") },
        "session.idle": async () => { own.push("idle") },
      },
    })

    // No sessionId → session.created fires; portable policies mean no small-model call.
    await runner.prompt({ parts: text, catalog: catalog() })

    expect(own).toEqual(["created", "provider", "loop", "idle"])
    expect(global).toEqual([])
  })
})

describe("runner hooks — same-name isolation", () => {
  test("two runners with the same hook name each run only their own handler", async () => {
    const seenA: string[] = []
    const seenB: string[] = []
    const capA = captureStream()
    const capB = captureStream()

    const runnerA = createRunner({
      agent: portableAgent("agent-a"),
      stream: capA.stream,
      hooks: { "loop.step.before": async () => { seenA.push("a") } },
    })
    const runnerB = createRunner({
      agent: portableAgent("agent-b"),
      stream: capB.stream,
      hooks: { "loop.step.before": async () => { seenB.push("b") } },
    })

    await runnerA.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })
    expect(seenA).toEqual(["a"])
    expect(seenB).toEqual([])

    await runnerB.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })
    expect(seenA).toEqual(["a"])
    expect(seenB).toEqual(["b"])
  })
})

describe("runner hooks — session.error for unhandled turn failures", () => {
  test("a fatal provider error fires session.error once, with provider hook/event fired once each", async () => {
    const sessionErrors: unknown[] = []
    const providerErrors: number[] = []
    const busErrors: unknown[] = []

    const fatal: StreamFn = () => {
      throw Object.assign(new Error("bad request"), { status: 400 })
    }

    const runner = createRunner({
      agent: portableAgent("failing"),
      stream: fatal,
      hooks: {
        "session.error": async ({ error }) => { sessionErrors.push(error) },
        "provider.request.error": async () => { providerErrors.push(1) },
      },
    })
    runner.bus.on("error", ({ error }) => busErrors.push(error))

    await expect(
      runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
    ).rejects.toThrow("bad request")

    // session.error is the single central hook for the failed turn; the
    // provider hook and bus error must not be duplicated by that path.
    expect(sessionErrors).toHaveLength(1)
    expect(providerErrors).toHaveLength(1)
    expect(busErrors).toHaveLength(1)
  })

  test("a successful turn never fires session.error", async () => {
    const sessionErrors: unknown[] = []
    const cap = captureStream()
    const runner = createRunner({
      agent: portableAgent("healthy"),
      stream: cap.stream,
      hooks: { "session.error": async ({ error }) => { sessionErrors.push(error) } },
    })

    await runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })

    expect(sessionErrors).toEqual([])
  })
})

describe("runner hooks — tool execution", () => {
  function sharedTool(mark: string) {
    return defineTool({
      id: "shared",
      description: "same id, different implementation",
      parameters: z.object({ x: z.number() }),
      async execute(args) {
        return { title: "shared", output: `${mark}:${args.x}`, metadata: {} }
      },
    })
  }

  test("PluginFn handlers register per runner and tool hooks only affect their own tools", async () => {
    const receivedA: string[] = []
    const capA = captureStream()
    const capB = captureStream()

    const runnerA = createRunner({
      agent: portableAgent("agent-a", [sharedTool("A")]),
      stream: capA.stream,
      plugins: [
        async () => ({
          "tool.execute.before": async (_input, output) => { output.args = { x: 10 } },
          "tool.execute.after": async (input) => { receivedA.push(input.result) },
        }),
      ],
    })
    const runnerB = createRunner({
      agent: portableAgent("agent-b", [sharedTool("B")]),
      stream: capB.stream,
      plugins: [
        async () => ({
          "tool.execute.before": async (_input, output) => { output.args = { x: 20 } },
        }),
      ],
    })

    await Promise.all([
      runnerA.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
      runnerB.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
    ])

    const call = { toolCallId: "call-1", messages: [], abortSignal: new AbortController().signal }
    const resultA = await capA.captured[0]!.tools["shared"].execute({ x: 1 }, call)
    const resultB = await capB.captured[0]!.tools["shared"].execute({ x: 1 }, call)

    expect(resultA.output).toBe("A:10")
    expect(resultB.output).toBe("B:20")
    expect(receivedA).toEqual(["A:10"])
  })
})
