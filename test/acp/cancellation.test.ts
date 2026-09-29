// QUA-250: ACP `session/cancel` wiring + cancellation semantics.
//
// Unit: registerCancellation forwards the notification to the bridge.
// Integration: through the real SDK, a cancel returns the `cancelled` stop
// reason even when the runner aborts by throwing, late updates arrive before
// the response, and the next prompt still works.

import { describe, expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { MemorySessionStore, type Runner, type SessionStore } from "@quark/runner"
import { createAcpAgent } from "../../packages/acp/src/index"
import { createSessionHandlers } from "../../packages/acp/src/sessions"
import { registerCancellation } from "../../packages/acp/src/cancellation"

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
    bridge.dispose()
    await expect(running).resolves.toEqual({ stopReason: "cancelled" })
  })
})
