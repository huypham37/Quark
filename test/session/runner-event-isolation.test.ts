// Runner event isolation (Step 3) — instance bus on the real prompt → loop →
// processStream path.
//
// Two layers:
//   1. processStream directly, with an injected `bus` + injected `stream`.
//      Drives every event family the task names (streaming text, reasoning,
//      tool lifecycle, step, retry/error, assistant completion) with no
//      network provider.
//   2. createRunner's default executor end to end: prompt → loop → processStream.
//      The stream seam on RunnerOptions keeps the model call offline, so this
//      proves the wiring, not just the processor.
//
// In all cases: events land on the runner's bus and never on another runner's
// bus or the legacy singleton.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRunner } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { createAssistantMessage } from "../../packages/runner/src/session/message"
import { createSession, setSessionTitle } from "../../packages/runner/src/session/session"
import { processStream, type StreamFn } from "../../packages/runner/src/session/processor"
import { bus as legacyBus, TypedBus, type BusEventName } from "../../packages/runner/src/session/events"
import type { ResolvedModel } from "../../packages/runner/src/provider/resolver"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { resolveToolSet } from "../../packages/runner/src/tool/ai-adapter"
import { defineTool, type ToolContext } from "../../packages/runner/src/tool/tool"
import { questionTool } from "../../packages/runner/src/tool/question"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const WATCH: BusEventName[] = [
  "session-created", "user-message", "loop-start", "loop-end",
  "assistant-message-start", "assistant-message-end", "user-message-status",
  "text-start", "text-delta", "text-end",
  "reasoning-start", "reasoning-delta", "reasoning-end",
  "tool-start", "tool-input", "tool-running", "tool-end",
  "step-start", "step-finish", "retry", "error", "context-too-long",
  "session-switch", "question-request",
]

interface Seen { name: BusEventName; data: any }

function watch(bus: TypedBus): Seen[] {
  const seen: Seen[] = []
  for (const name of WATCH) bus.on(name, (data) => seen.push({ name, data }))
  return seen
}

function textPart(events: Seen[], name: BusEventName): string | undefined {
  return events.find((event) => event.name === name)?.data?.delta
}

function streamOf(events: any[]): StreamFn {
  return () => ({
    fullStream: (async function* () {
      for (const event of events) yield event
    })(),
  })
}

function fakeResolvedModel(): ResolvedModel {
  return {
    languageModel: {} as any,
    ref: { providerId: "test", modelId: "test-model", spec: "test/test-model" },
    provider: {} as any,
    catalogModel: {
      id: "test-model",
      name: "Test",
      description: "test",
      attachment: false,
      reasoning: false,
      tool_call: true,
      release_date: "2025-01-01",
      last_updated: "2025-01-01",
      modalities: { input: ["text"], output: ["text"] },
      open_weights: false,
      limit: { context: 100_000, output: 4_000 },
    },
    pricingSnapshot: { kind: "subscription" },
    providerOptionsKey: "test",
  } as ResolvedModel
}

let storageRoot: string

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "quark-test-runner-events-"))
  setSessionStorageRoot(storageRoot)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
})

afterEach(() => {
  legacyBus.removeAllListeners()
  delete process.env.QUARK_SESSION_ID
})

// ---------------------------------------------------------------------------
// 1. processStream — injected bus + injected stream
// ---------------------------------------------------------------------------

describe("processStream routes every event family through the injected bus", () => {
  test("text, reasoning, tool, step, and assistant completion reach only that bus", async () => {
    const session = createSession()
    const message = createAssistantMessage({ sessionId: session.id })
    const busA = new TypedBus()
    const busB = new TypedBus()
    const seenA = watch(busA)
    const seenB = watch(busB)
    const seenLegacy = watch(legacyBus)

    const result = await processStream({
      model: {} as any,
      resolvedModel: fakeResolvedModel(),
      system: [],
      messages: [{ role: "user", content: "hi" }],
      tools: {},
      abort: new AbortController().signal,
      msg: message,
      sessionId: session.id,
      userMessageId: "user-message",
      bus: busA,
      stream: streamOf([
        { type: "start" },
        { type: "start-step" },
        { type: "reasoning-start" },
        { type: "reasoning-delta", text: "thinking" },
        { type: "reasoning-end" },
        { type: "text-start" },
        { type: "text-delta", text: "hello" },
        { type: "text-end" },
        { type: "tool-input-start", id: "call-1", toolName: "fake-tool" },
        { type: "tool-call", toolCallId: "call-1", toolName: "fake-tool", input: { x: 1 } },
        { type: "tool-result", toolCallId: "call-1", input: { x: 1 }, output: { output: "ok" } },
        { type: "finish-step", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 2 } },
        { type: "finish" },
      ]),
    })

    expect(result).toBe("stop")
    const names = seenA.map((event) => event.name)
    expect(names).toContain("text-start")
    expect(textPart(seenA, "text-delta")).toBe("hello")
    expect(names).toContain("text-end")
    expect(names).toContain("reasoning-start")
    expect(textPart(seenA, "reasoning-delta")).toBe("thinking")
    expect(names).toContain("reasoning-end")
    expect(names).toContain("tool-start")
    expect(names).toContain("tool-input")
    expect(names).toContain("tool-end")
    expect(names).toContain("step-start")
    expect(names).toContain("step-finish")
    expect(names).toContain("assistant-message-end")

    expect(seenB).toEqual([])
    expect(seenLegacy).toEqual([])
  })

  test("abort ends a stalled stream without waiting for its iterator", async () => {
    const session = createSession()
    const message = createAssistantMessage({ sessionId: session.id })
    const eventBus = new TypedBus()
    const seen = watch(eventBus)
    const controller = new AbortController()
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    const stalled: StreamFn = () => ({
      fullStream: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              started()
              return new Promise<IteratorResult<any>>(() => {})
            },
            return() { return new Promise<IteratorResult<any>>(() => {}) },
          }
        },
      },
    })
    const run = processStream({
      model: {} as any,
      resolvedModel: fakeResolvedModel(),
      system: [], messages: [], tools: {}, abort: controller.signal,
      msg: message, sessionId: session.id, userMessageId: "user-message",
      bus: eventBus, stream: stalled,
    })
    await waiting
    controller.abort()
    expect(await Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error("abort stalled")), 500))])).toBe("stop")
    expect(seen.find((event) => event.name === "assistant-message-end")?.data.finish).toBe("aborted")
  })

  test("retryable errors emit retry on the injected bus, not the singleton", async () => {
    const session = createSession()
    const message = createAssistantMessage({ sessionId: session.id })
    const busA = new TypedBus()
    const seenA = watch(busA)
    const seenLegacy = watch(legacyBus)

    let calls = 0
    const flaky: StreamFn = () => {
      calls++
      if (calls === 1) {
        throw Object.assign(new Error("rate limited"), {
          status: 429,
          responseHeaders: { "retry-after": "0.001" },
        })
      }
      return {
        fullStream: (async function* () {
          yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: "finish" }
        })(),
      }
    }

    const result = await processStream({
      model: {} as any,
      resolvedModel: fakeResolvedModel(),
      system: [],
      messages: [],
      tools: {},
      abort: new AbortController().signal,
      msg: message,
      sessionId: session.id,
      userMessageId: "user-message",
      bus: busA,
      stream: flaky,
    })

    expect(result).toBe("stop")
    expect(calls).toBe(2)
    expect(seenA.map((event) => event.name)).toContain("retry")
    expect(seenA.map((event) => event.name)).toContain("assistant-message-end")
    expect(seenLegacy).toEqual([])
  })

  test("fatal errors emit error on the injected bus and rethrow", async () => {
    const session = createSession()
    const message = createAssistantMessage({ sessionId: session.id })
    const busA = new TypedBus()
    const seenA = watch(busA)
    const seenLegacy = watch(legacyBus)

    const fatal: StreamFn = () => {
      throw Object.assign(new Error("bad request"), { status: 400 })
    }

    await expect(processStream({
      model: {} as any,
      resolvedModel: fakeResolvedModel(),
      system: [],
      messages: [],
      tools: {},
      abort: new AbortController().signal,
      msg: message,
      sessionId: session.id,
      userMessageId: "user-message",
      bus: busA,
      stream: fatal,
    })).rejects.toThrow("bad request")

    expect(seenA.map((event) => event.name)).toContain("error")
    expect(seenLegacy).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 1b. Tool collaborators — tool-running, ToolContext.bus, question-request
// ---------------------------------------------------------------------------

describe("tool collaborators emit on the injected bus", () => {
  test("resolveToolSet emits tool-running on its bus and hands tools that bus", async () => {
    let capturedBus: TypedBus | undefined
    const fakeTool = defineTool({
      id: "isolation-fake-tool",
      description: "test tool",
      parameters: z.object({ x: z.number() }),
      async execute(_args, ctx: ToolContext) {
        capturedBus = ctx.bus
        return { title: "t", output: "ok", metadata: {} }
      },
    })

    const busA = new TypedBus()
    const busB = new TypedBus()
    const seenA = watch(busA)
    const seenB = watch(busB)
    const seenLegacy = watch(legacyBus)

    const tools = resolveToolSet(
      { tools: [fakeTool] },
      "session-1",
      "message-1",
      new AbortController().signal,
      busA,
    )
    await (tools["isolation-fake-tool"] as any).execute(
      { x: 1 },
      { toolCallId: "call-1", messages: [], abortSignal: new AbortController().signal },
    )

    expect(seenA.map((event) => event.name)).toContain("tool-running")
    expect(capturedBus).toBe(busA)
    expect(seenB).toEqual([])
    expect(seenLegacy).toEqual([])
  })

  test("question tool emits question-request on ctx.bus", async () => {
    const busA = new TypedBus()
    const busB = new TypedBus()
    const seenA = watch(busA)
    const seenB = watch(busB)
    const seenLegacy = watch(legacyBus)

    const controller = new AbortController()
    const pending = questionTool.execute(
      { questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "go" }] }] },
      { sessionId: "session-1", messageId: "message-1", callId: "call-1", abort: controller.signal, bus: busA },
    )

    expect(seenA.map((event) => event.name)).toContain("question-request")
    controller.abort()
    await pending

    expect(seenB).toEqual([])
    expect(seenLegacy).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. createRunner default executor — full prompt → loop → processStream path
// ---------------------------------------------------------------------------

function catalogWithTestModel(): CatalogRegistry {
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

function offlineAgent(id: string) {
  return defineAgent({ id, name: id, instructions: `${id} instructions`, tools: [], model: "ollama/test-model" })
}

function titledSession(): string {
  const session = createSession()
  setSessionTitle(session.id, "test session")
  return session.id
}

describe("createRunner default executor routes the real loop through its bus", () => {
  test("a runner's streaming events never reach another runner or the legacy bus", async () => {
    const catalog = catalogWithTestModel()
    const sessionA = titledSession()
    const sessionB = titledSession()

    const runnerA = createRunner({ agent: offlineAgent("agent-a"), stream: streamOf([
      { type: "text-start" },
      { type: "text-delta", text: "from-a" },
      { type: "text-end" },
      { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
      { type: "finish" },
    ]) })
    const runnerB = createRunner({ agent: offlineAgent("agent-b"), stream: streamOf([
      { type: "text-start" },
      { type: "text-delta", text: "from-b" },
      { type: "text-end" },
      { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
      { type: "finish" },
    ]) })

    const seenA = watch(runnerA.bus)
    const seenB = watch(runnerB.bus)
    const seenLegacy = watch(legacyBus)

    await Promise.all([
      runnerA.prompt({ sessionId: sessionA, parts: [{ type: "text", text: "hi a" }], catalog }),
      runnerB.prompt({ sessionId: sessionB, parts: [{ type: "text", text: "hi b" }], catalog }),
    ])

    // The real loop reached processStream on the default executor.
    const namesA = seenA.map((event) => event.name)
    expect(namesA).toContain("loop-start")
    expect(namesA).toContain("assistant-message-start")
    expect(namesA).toContain("text-delta")
    expect(namesA).toContain("step-finish")
    expect(namesA).toContain("assistant-message-end")
    expect(namesA).toContain("loop-end")
    expect(textPart(seenA, "text-delta")).toBe("from-a")

    expect(textPart(seenB, "text-delta")).toBe("from-b")
    // No cross-talk: A's event names never appear with B's session id.
    expect(seenA.every((event) => event.data?.sessionId === sessionA)).toBe(true)
    expect(seenB.every((event) => event.data?.sessionId === sessionB)).toBe(true)
    expect(seenLegacy).toEqual([])
  })

  test("canceling a stream stuck in next() emits loop-end so the UI can dequeue", async () => {
    const catalog = catalogWithTestModel()
    const sessionId = titledSession()
    let wake!: () => void
    const entered = new Promise<void>((resolve) => { wake = resolve })
    const runner = createRunner({ agent: offlineAgent("stalled"), stream: () => ({
      fullStream: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              wake()
              return new Promise<IteratorResult<any>>(() => {})
            },
            return() { return new Promise<IteratorResult<any>>(() => {}) },
          }
        },
      },
    }) })
    const seen = watch(runner.bus)
    const run = runner.prompt({ sessionId, parts: [{ type: "text", text: "first" }], catalog })
    await entered
    runner.cancel(sessionId)
    await Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error("loop-end stalled")), 500))])
    expect(seen.map((event) => event.name)).toContain("loop-end")
    expect(seen.find((event) => event.name === "user-message-status")?.data.status).toBe("aborted")
    expect(runner.hasActiveRun()).toBe(false)
  })

  test("cancel() only aborts the runner's own run", async () => {
    const catalog = catalogWithTestModel()
    const sessionA = titledSession()
    const sessionB = titledSession()

    // A stream that resolves after a delay — a fake offline hang.
    const hanging = (): StreamFn => () => ({
      fullStream: (async function* () {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    })

    const runnerA = createRunner({ agent: offlineAgent("agent-a"), stream: hanging() })
    const runnerB = createRunner({ agent: offlineAgent("agent-b"), stream: hanging() })
    const seenB = watch(runnerB.bus)

    const runA = runnerA.prompt({ sessionId: sessionA, parts: [{ type: "text", text: "a" }], catalog })
    const runB = runnerB.prompt({ sessionId: sessionB, parts: [{ type: "text", text: "b" }], catalog })

    expect(runnerA.isActive(sessionA)).toBe(true)
    runnerA.cancel(sessionA)
    expect(runnerA.isActive(sessionA)).toBe(false)
    expect(runnerB.isActive(sessionB)).toBe(true)

    await Promise.all([runA, runB])
    expect(runnerA.isActive(sessionA)).toBe(false)
    expect(runnerB.isActive(sessionB)).toBe(false)
    expect(seenB.map((event) => event.name)).toContain("assistant-message-end")
  })
})

// ---------------------------------------------------------------------------
// 3. Portable concurrent runs — process-global turn state stays untouched
//
// Same session ID, same tool ID, two runners in flight. The instance path must
// not write QUARK_SESSION_ID, must not emit title events on the singleton bus,
// and tool execution must route through each runner's own bus.
// ---------------------------------------------------------------------------

function portableAgent(id: string, tools: ReturnType<typeof defineTool>[] = []) {
  return defineAgent({ id, instructions: `${id} instructions`, tools, model: "ollama/test-model" })
}

const stopStream: StreamFn = () => ({
  fullStream: (async function* () {
    yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: "finish" }
  })(),
})

describe("portable runners never touch process-global turn state", () => {
  test("concurrent same-ID runs keep QUARK_SESSION_ID and the singleton bus untouched", async () => {
    const catalog = catalogWithTestModel()
    const SAME = "shared-portable-session"
    const SENTINEL = "sentinel-session-id"
    process.env.QUARK_SESSION_ID = SENTINEL

    const titlesA: Array<{ title: string | null }> = []
    const titlesB: Array<{ title: string | null }> = []
    const legacyTitles: Array<{ title: string | null }> = []

    const runnerA = createRunner({ agent: portableAgent("p-a"), stream: stopStream })
    const runnerB = createRunner({ agent: portableAgent("p-b"), stream: stopStream })

    runnerA.bus.on("session-title-changed", (data) => titlesA.push(data))
    runnerB.bus.on("session-title-changed", (data) => titlesB.push(data))
    legacyBus.on("session-title-changed", (data) => legacyTitles.push(data))

    await Promise.all([
      runnerA.prompt({ sessionId: SAME, parts: [{ type: "text", text: "alpha title" }], catalog }),
      runnerB.prompt({ sessionId: SAME, parts: [{ type: "text", text: "bravo title" }], catalog }),
    ])

    // The process-global session id is never written by an instance runner.
    expect(process.env.QUARK_SESSION_ID).toBe(SENTINEL)
    // Title events land on each runner's own bus, never the singleton.
    expect(legacyTitles).toEqual([])
    expect(titlesA.map((data) => data.title)).toEqual(["alpha title"])
    expect(titlesB.map((data) => data.title)).toEqual(["bravo title"])
  })

  test("concurrent same-ID tools execute against their own runner bus", async () => {
    const catalog = catalogWithTestModel()
    const toolsA: Record<string, any>[] = []
    const toolsB: Record<string, any>[] = []

    function captureTools(sink: Record<string, any>[]): StreamFn {
      return (options) => {
        sink.push(options.tools)
        return stopStream(options)
      }
    }

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

    const runnerA = createRunner({
      agent: portableAgent("tool-a", [sharedTool("A")]),
      stream: captureTools(toolsA),
    })
    const runnerB = createRunner({
      agent: portableAgent("tool-b", [sharedTool("B")]),
      stream: captureTools(toolsB),
    })

    const seenA = watch(runnerA.bus)
    const seenB = watch(runnerB.bus)
    const seenLegacy = watch(legacyBus)

    await Promise.all([
      runnerA.prompt({ sessionId: "shared-tool-session", parts: [{ type: "text", text: "a" }], catalog }),
      runnerB.prompt({ sessionId: "shared-tool-session", parts: [{ type: "text", text: "b" }], catalog }),
    ])

    const call = { toolCallId: "call-1", messages: [], abortSignal: new AbortController().signal }
    const [resultA, resultB] = await Promise.all([
      toolsA[0]!["shared"].execute({ x: 1 }, call),
      toolsB[0]!["shared"].execute({ x: 1 }, call),
    ])

    expect(resultA.output).toBe("A:1")
    expect(resultB.output).toBe("B:1")
    expect(seenA.map((event) => event.name)).toContain("tool-running")
    expect(seenB.map((event) => event.name)).toContain("tool-running")
    expect(seenLegacy.filter((event) => event.name === "tool-running")).toEqual([])
  })
})
