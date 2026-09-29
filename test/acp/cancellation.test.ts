// QUA-250: ACP `session/cancel` wiring + cancellation semantics.
//
// Unit: registerCancellation forwards the notification to the bridge.
// Integration: through the real SDK, a cancel returns the `cancelled` stop
// reason even when the runner aborts by throwing, late updates arrive before
// the response, and the next prompt still works.

import { describe, expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import {
  MemorySessionStore,
  createRunner,
  defineAgent,
  type Runner,
  type SessionStore,
} from "@quark/runner"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import type { StreamFn } from "../../packages/runner/src/session/processor"
import { createAcpAgent } from "../../packages/acp/src/index"
import { createSessionHandlers } from "../../packages/acp/src/sessions"
import { registerCancellation } from "../../packages/acp/src/cancellation"
import { createPermissionBridge } from "../../packages/acp/src/permissions"

type Listener = (data: any) => void

/**
 * A fake runner that blocks on `prompt` until cancelled. `cancel` mimics the
 * engine: it emits its final aborted bus event synchronously, then rejects the
 * pending prompt with an AbortError. After one cancellation, later prompts
 * resolve immediately so a follow-up turn can be exercised.
 */
function makeFakeRunner(store?: SessionStore) {
  const listeners = new Map<string, Set<Listener>>()
  let markEntered!: () => void
  const entered = new Promise<void>((resolve) => (markEntered = resolve))
  let rejectPrompt: ((error: unknown) => void) | null = null
  let active = false
  let wasCancelled = false
  let runnerSessionId = "runner-session-1"

  const emit = (name: string, data: any) => {
    for (const fn of listeners.get(name) ?? []) fn(data)
  }

  const runner = {
    bus: {
      on(name: string, fn: Listener) {
        const set = listeners.get(name) ?? new Set<Listener>()
        set.add(fn)
        listeners.set(name, set)
      },
      off(name: string, fn: Listener) {
        listeners.get(name)?.delete(fn)
      },
      emit,
    },
    store,
    prompt(input?: { sessionId?: string }) {
      // Honor a supplied persisted id instead of minting a competing one.
      runnerSessionId = input?.sessionId ?? runnerSessionId
      emit("session-created", { sessionId: runnerSessionId })
      active = true
      markEntered()
      if (wasCancelled) {
        active = false
        return Promise.resolve({ sessionId: runnerSessionId })
      }
      return new Promise<{ sessionId: string }>((_resolve, reject) => {
        rejectPrompt = reject
      })
    },
    cancel(id: string) {
      if (!active) return
      active = false
      wasCancelled = true
      // Real engine: aborted bus events are emitted before prompt() settles.
      // A late update after the cancel must still precede the response.
      emit("text-delta", { sessionId: id, messageId: "msg-1", delta: "partial" })
      emit("assistant-message-end", { sessionId: id, finish: "aborted" })
      rejectPrompt?.(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
    },
    isActive: () => active,
    hasActiveRun: () => active,
    /** Resolves once a prompt has entered the runner. */
    entered,
  }
  return runner
}

const asRunner = (runner: ReturnType<typeof makeFakeRunner>) => runner as unknown as Runner

describe("registerCancellation", () => {
  test("installs session/cancel and forwards the session ID to the bridge", () => {
    const handlers = new Map<string, (ctx: any) => void>()
    const app = {
      onNotification(method: string, handler: (ctx: any) => void) {
        handlers.set(method, handler)
        return app
      },
    }
    const cancelled: string[] = []
    const sessions = { cancel: ({ sessionId }: { sessionId: string }) => cancelled.push(sessionId) }

    registerCancellation(app as any, sessions as any)
    expect([...handlers.keys()]).toEqual([acp.methods.agent.session.cancel])

    handlers.get(acp.methods.agent.session.cancel)!({ params: { sessionId: "sess-1" } })
    expect(cancelled).toEqual(["sess-1"])
  })
})

describe("cancellation", () => {
  test("session/cancel returns cancelled when the runner throws AbortError, updates first", async () => {
    const store = new MemorySessionStore()
    const runner = makeFakeRunner(store)
    const agent = createAcpAgent({
      store,
      createRunner: () => asRunner(runner),
      onTurnStart: (turn) => {
        // Stand-in for QUA-244: forward the runner's final aborted event as a
        // session/update notification, without awaiting the write.
        turn.runner.bus.on("assistant-message-end", () => {
          void turn.client.notify(acp.methods.client.session.update, {
            sessionId: turn.acpSessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "cancelled" },
            },
          })
        })
      },
    })

    await acp.client({ name: "cancel-test" }).connectWith(agent.app, async (ctx) => {
      const session = await ctx.buildSession("/workspace").start()
      const pending = session.prompt("stop me")
      await runner.entered
      await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })

      const order: string[] = []
      let stopReason: string | undefined
      for (;;) {
        const message = await session.nextUpdate()
        order.push(message.kind)
        if (message.kind === "stop") {
          stopReason = message.stopReason
          break
        }
      }

      expect(stopReason).toBe("cancelled")
      expect(await pending).toEqual({ stopReason: "cancelled" })
      // The late session/update from the aborted turn precedes the response.
      expect(order).toEqual(["session_update", "stop"])
      session.dispose()
    })
  })

  test("late updates are flushed before the cancelled response (default bridge)", async () => {
    const store = new MemorySessionStore()
    const runner = makeFakeRunner(store)
    // No onTurnStart override: use the real QUA-244 update bridge, which flushes
    // its queued notifications before runner.prompt() settles.
    const agent = createAcpAgent({ store, createRunner: () => asRunner(runner) })

    await acp.client({ name: "cancel-order" }).connectWith(agent.app, async (ctx) => {
      const session = await ctx.buildSession("/workspace").start()
      const pending = session.prompt("stop me")
      await runner.entered
      await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })

      const order: string[] = []
      for (;;) {
        const message = await session.nextUpdate()
        order.push(message.kind)
        if (message.kind === "stop") break
      }

      expect(await pending).toEqual({ stopReason: "cancelled" })
      expect(order).toEqual(["session_update", "stop"])
      session.dispose()
    })
  })

  test("a prompt after a cancelled turn still works", async () => {
    const store = new MemorySessionStore()
    const runner = makeFakeRunner(store)
    const agent = createAcpAgent({ store, createRunner: () => asRunner(runner) })

    await acp.client({ name: "cancel-test" }).connectWith(agent.app, async (ctx) => {
      const session = await ctx.buildSession("/workspace").start()
      const first = session.prompt("one")
      await runner.entered
      await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })
      expect(await first).toEqual({ stopReason: "cancelled" })

      expect(await session.prompt("two")).toEqual({ stopReason: "end_turn" })
      session.dispose()
    })
  })

  test("dispose cancels an active runner; an AbortError still yields cancelled", async () => {
    const store = new MemorySessionStore()
    const runner = makeFakeRunner(store)
    const bridge = createSessionHandlers({ store, createRunner: () => asRunner(runner) })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as any)

    const running = bridge.prompt(
      { sessionId, prompt: [{ type: "text", text: "x" }] } as any,
      { signal: new AbortController().signal, client: {} as any },
    )
    await runner.entered
    // dispose() aborts without setting the "cancelled" flag: the AbortError
    // normalization alone must produce the cancelled stop reason.
    await bridge.dispose()
    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
  })
})

// ---------------------------------------------------------------------------
// QUA-264: one turn-level abort signal covering provider, tools, permission
// and MCP. `session/cancel` is a notification, so it never touches ctx.signal;
// it aborts the turn controller the runner and bridges share.
// ---------------------------------------------------------------------------

const MODEL = "ollama/test-model"

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
          release_date: "2026-01-01",
          last_updated: "2026-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 100_000, output: 4_000 },
        },
      },
    },
  }, { fetchedAt: 1 }))
}

function offlineAgent(id: string, tools: Parameters<typeof defineAgent>[0]["tools"] = []) {
  return defineAgent({ id, name: id, instructions: `${id} instructions`, tools, model: MODEL })
}

const textPrompt = { prompt: [{ type: "text", text: "go" }] } as never
const callCtx = (signal = new AbortController().signal, client: unknown = {}) =>
  ({ signal, client } as never)

/** A runner whose execute fires the permission seam (like a real tool call). */
function permissionRunner(store: SessionStore) {
  return createRunner({
    agent: offlineAgent("perm"),
    store,
    execute: async (input, ctx) => {
      const args = { filePath: "/x" }
      try {
        await ctx.hooks.fire(
          "tool.execute.before",
          { tool: "write", args, sessionId: input.sessionId!, callId: "call-1" },
          { args },
        )
      } catch (error) {
        // A denial is a tool error the model can react to; only a real abort
        // ends the turn. Mirrors the engine's tool-error path.
        if ((error as { name?: string }).name === "AbortError") throw error
      }
      return { sessionId: input.sessionId! }
    },
  })
}

describe("QUA-264: one turn-level abort signal", () => {
  test("session/cancel while a permission request is pending ends the turn cancelled, no hang", async () => {
    const store = new MemorySessionStore()
    const bridge = createSessionHandlers({
      store,
      createRunner: () => permissionRunner(store),
      onTurnStart: createPermissionBridge({ log: () => {} }).onTurnStart,
    })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    let requested!: () => void
    const pendingPermission = new Promise<void>((resolve) => (requested = resolve))
    const client = {
      request: () => {
        requested()
        return new Promise(() => {}) // the dialog never answers
      },
    }

    const running = bridge.prompt({ sessionId, ...textPrompt } as never, callCtx(new AbortController().signal, client))
    await pendingPermission
    const started = Date.now()
    bridge.cancel({ sessionId })

    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
    expect(Date.now() - started).toBeLessThan(500)
  })

  test("a denied tool ends the turn as a tool error, never a cancellation", async () => {
    const store = new MemorySessionStore()
    let turnSignal: AbortSignal | undefined
    const bridge = createSessionHandlers({
      store,
      createRunner: () => permissionRunner(store),
      onTurnStart: (turn) => {
        createPermissionBridge({ log: () => {} }).onTurnStart(turn)
        turnSignal = turn.signal
      },
    })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    const client = {
      request: async () => ({ outcome: { outcome: "selected", optionId: "reject_once" } }),
    }
    const result = await bridge.prompt(
      { sessionId, ...textPrompt } as never,
      { signal: new AbortController().signal, client } as never,
    )
    expect(result).toEqual({ stopReason: "end_turn" })
    expect(turnSignal?.aborted).toBe(false)
  })

  test("cancel before the runner announces its session id aborts the turn", async () => {
    const store = new MemorySessionStore()
    let entered!: () => void
    const enteredP = new Promise<void>((resolve) => (entered = resolve))
    let observedAbort = false
    let resolveValue!: (value: { sessionId: string }) => void

    // Models the pre-announcement gap: the runner cannot target its own run
    // yet (cancel is a no-op), so only the shared controller can stop it.
    const runner = createRunner({
      agent: offlineAgent("gap"),
      store,
      execute: (input, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true
              resolve({ sessionId: input.sessionId! })
            },
            { once: true },
          )
          entered()
          resolveValue = resolve
        }),
    })
    // A runner that has not registered the run yet: cancel() reaches nothing.
    const noopCancel = { ...runner, cancel: () => {} } as Runner
    const bridge = createSessionHandlers({ store, createRunner: () => noopCancel })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    const running = bridge.prompt({ sessionId, ...textPrompt } as never, callCtx())
    await enteredP
    bridge.cancel({ sessionId })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(observedAbort).toBe(true)

    // A value returned after the abort must never be reported as end_turn.
    resolveValue({ sessionId: "late" })
    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
  })

  test("an aborted ctx.signal (connection close) still cancels the turn", async () => {
    const store = new MemorySessionStore()
    let entered!: () => void
    const enteredP = new Promise<void>((resolve) => (entered = resolve))
    const runner = createRunner({
      agent: offlineAgent("close"),
      store,
      execute: (_input, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })
          entered()
        }),
    })
    const bridge = createSessionHandlers({ store, createRunner: () => runner })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    const request = new AbortController()
    const running = bridge.prompt({ sessionId, ...textPrompt } as never, callCtx(request.signal))
    await enteredP
    request.abort()
    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
  })

  test("SessionTurn.signal is not aborted on a normal end_turn", async () => {
    const store = new MemorySessionStore()
    let turnSignal: AbortSignal | undefined
    const runner = createRunner({
      agent: offlineAgent("ok"),
      store,
      execute: async (input) => ({ sessionId: input.sessionId! }),
    })
    const bridge = createSessionHandlers({
      store,
      createRunner: () => runner,
      onTurnStart: (turn) => { turnSignal = turn.signal },
    })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    await expect(bridge.prompt({ sessionId, ...textPrompt } as never, callCtx())).resolves.toEqual({ stopReason: "end_turn" })
    expect(turnSignal?.aborted).toBe(false)
  })

  test("after a cancelled turn the next prompt succeeds with no leaked abort state", async () => {
    const store = new MemorySessionStore()
    let turns = 0
    let firstEntered!: () => void
    const firstEnteredP = new Promise<void>((resolve) => (firstEntered = resolve))
    const runner = createRunner({
      agent: offlineAgent("repeat"),
      store,
      execute: async (input, ctx) => {
        turns++
        if (turns === 1) {
          firstEntered()
          await new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })
          })
        }
        return { sessionId: input.sessionId! }
      },
    })
    const bridge = createSessionHandlers({ store, createRunner: () => runner })
    const { sessionId } = bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

    const first = bridge.prompt({ sessionId, ...textPrompt } as never, callCtx())
    await firstEnteredP
    bridge.cancel({ sessionId })
    await expect(first).resolves.toEqual({ stopReason: "cancelled" })
    await expect(bridge.prompt({ sessionId, ...textPrompt } as never, callCtx())).resolves.toEqual({ stopReason: "end_turn" })
  })

  test("session/cancel during an in-flight MCP call rejects it and ends cancelled", async () => {
    const store = new MemorySessionStore()
    const slowTool = "mcp__slow__slow"
    let inFlight!: () => void
    const inFlightP = new Promise<void>((resolve) => (inFlight = resolve))
    const outcome: { state: "pending" | "resolved" | "rejected" } = { state: "pending" }

    // Drives the tool loop's tool call the way the AI SDK would, honoring the
    // turn's abortSignal — so this exercises toAITool -> ctx.abort -> MCP.
    const stream: StreamFn = (options) => ({
      fullStream: (async function* () {
        yield { type: "tool-input-start", id: "call-1", toolName: slowTool }
        yield { type: "tool-call", toolCallId: "call-1", toolName: slowTool, input: { text: "hi" } }
        inFlight()
        try {
          const result = await options.tools[slowTool].execute(
            { text: "hi" },
            { toolCallId: "call-1", messages: [], abortSignal: options.abortSignal },
          )
          outcome.state = "resolved"
          yield { type: "tool-result", toolCallId: "call-1", toolName: slowTool, input: { text: "hi" }, output: result }
        } catch (error) {
          outcome.state = "rejected"
          throw error
        }
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    })

    const slowServer = {
      name: "slow",
      command: process.execPath,
      args: [new URL("./fixtures/mcp-slow-server.mjs", import.meta.url).pathname],
      env: [],
    }
    const bridge = createSessionHandlers({
      store,
      createRunner: (_cwd, mcpTools) =>
        createRunner({
          agent: offlineAgent("mcp", mcpTools),
          store,
          resolve: { catalog: catalogWithTestModel() },
          stream,
        }),
    })
    const { sessionId } = await bridge.newSession({ cwd: "/workspace", mcpServers: [slowServer] } as never)

    const running = bridge.prompt({ sessionId, ...textPrompt } as never, callCtx())
    await inFlightP
    // Let the tool seam actually reach `callTool` before cancelling, so the
    // abort races an in-flight request rather than pre-empting the call.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const started = Date.now()
    bridge.cancel({ sessionId })

    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
    expect(outcome.state).toBe("rejected")
    // Promptly: well before the fixture's own 300ms answer.
    expect(Date.now() - started).toBeLessThan(250)
    bridge.close({ sessionId })
  })
})

