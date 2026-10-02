// QUA-247 end-to-end: shared store + persistent resume/load through the real
// SDK. Runners are fakes, but the store is a real MemorySessionStore and the
// connection is a real ACP client, so the mapping and the restart path are
// exercised for real: a session created on one connection is listed, resumed
// and continued by a fresh connection over the same store.

import { expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { MemorySessionStore, createSession, type Runner, type SessionStore } from "@quark/runner"
import { addPart, createAssistantMessage, saveUserMessage } from "@quark/runner/session/message"
import { createAcpAgent } from "../../packages/acp/src/index"

type Listener = (data: any) => void

/** Await a condition the in-process connection flips on a later microtask. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
  if (!predicate()) throw new Error("condition was not met")
}

// Shared so runner ids stay unique across generations (mirrors the engine's
// per-session nanoids).
let runnerSeq = 0

/**
 * Fake runner that mirrors the engine's persistence contract: on a first prompt
 * it mints an id and creates the session in the shared store; the id is emitted
 * synchronously on `session-created` (as the engine does) so the bridge can
 * latch it. With `manual`, a turn blocks until `cancel` (or `release`).
 */
function makeFakeRunner(store: SessionStore, options: { manual?: boolean } = {}) {
  const prompts: Array<{ sessionId?: string; targetWorkspace?: string; parts: unknown[] }> = []
  const cancelled: string[] = []
  const listeners = new Map<string, Set<Listener>>()
  let releaseGate: (() => void) | null = null
  let enteredResolve: () => void = () => {}
  const entered = new Promise<void>((resolve) => (enteredResolve = resolve))

  const emit = (name: string, data: unknown) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(data)
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
    async prompt(input: { sessionId?: string; targetWorkspace?: string; parts: unknown[] }) {
      prompts.push(input)
      const sessionId = input.sessionId ?? `runner-${++runnerSeq}`
      if (!store.get(sessionId)) {
        createSession({ id: sessionId, directory: input.targetWorkspace ?? "/workspace" }, store)
      }
      // Mirror the engine: the user message lands in the store before the turn.
      saveUserMessage({
        sessionId,
        text: (input.parts as Array<{ text: string }>).map((part) => part.text).join("\n"),
        store,
      })
      emit("session-created", { sessionId })
      enteredResolve()
      if (options.manual) await new Promise<void>((resolve) => (releaseGate = resolve))
      return { sessionId }
    },
    cancel(id: string) {
      cancelled.push(id)
      releaseGate?.()
    },
    isActive: () => false,
    hasActiveRun: () => false,
    store,
  }

  return { runner: runner as unknown as Runner, prompts, cancelled, entered, release: () => releaseGate?.() }
}

test("a session survives a restart and resume/load continue the same persisted id", async () => {
  const store = new MemorySessionStore()
  const first = createAcpAgent({ store, createRunner: (_cwd, s) => makeFakeRunner(s).runner })

  let returnedId = ""
  await acp.client({ name: "before-restart" }).connectWith(first.app, async (ctx) => {
    const session = await ctx.buildSession("/workspace").start()
    returnedId = session.sessionId
    await session.prompt("hello")
    session.dispose()

    // The id session/new returned is the one that got persisted, and the one
    // session/list reports — no second, runner-minted session.
    expect(store.get(returnedId)?.directory).toBe("/workspace")
    const listed = await ctx.request(acp.methods.agent.session.list, {})
    expect(listed.sessions.map((s) => s.sessionId)).toEqual([returnedId])
    expect(listed.sessions[0]!.cwd).toBe("/workspace")
    expect(store.replay(returnedId).messages).toHaveLength(1)
  })
  await first.sessions.dispose()
  expect(store.get(returnedId)).not.toBeNull()

  // A fresh connection over the SAME store is the restart.
  const runners: Array<ReturnType<typeof makeFakeRunner>> = []
  const second = createAcpAgent({
    store,
    createRunner: (_cwd, s) => {
      const fake = makeFakeRunner(s)
      runners.push(fake)
      return fake.runner
    },
  })

  await acp.client({ name: "after-restart" }).connectWith(second.app, async (ctx) => {
    const listed = await ctx.request(acp.methods.agent.session.list, {})
    expect(listed.sessions.map((s) => s.sessionId)).toEqual([returnedId])

    // Load replays the stored history, resume attaches — both with the
    // originally returned ACP id, never a runner-minted one.
    await ctx.request(acp.methods.agent.session.load, {
      sessionId: returnedId,
      cwd: "/workspace",
      mcpServers: [],
    })
    expect(
      await ctx.request(acp.methods.agent.session.resume, { sessionId: returnedId, cwd: "/workspace" }),
    ).toEqual({})
    expect(second.sessions.runnerSessionId(returnedId)).toBe(returnedId)

    // The next prompt is handed the persisted id, so the engine resumes the
    // stored history instead of starting a new session.
    await ctx.request(acp.methods.agent.session.prompt, {
      sessionId: returnedId,
      prompt: [{ type: "text", text: "again" }],
    })
    expect(runners).toHaveLength(1)
    expect(runners[0]!.prompts[0]!.sessionId).toBe(returnedId)
    expect(runners[0]!.prompts[0]!.targetWorkspace).toBe("/workspace")
    // History was appended to the same single session, not forked.
    expect(store.list().map((s) => s.id)).toEqual([returnedId])
    expect(store.replay(returnedId).messages).toHaveLength(2)
  })
})

test("active delete is refused; close cancels the turn and frees the session", async () => {
  const store = new MemorySessionStore()
  createSession({ id: "s-1", directory: "/workspace" }, store)
  const runners: Array<ReturnType<typeof makeFakeRunner>> = []
  const agent = createAcpAgent({
    store,
    createRunner: (_cwd, s) => {
      const fake = makeFakeRunner(s, { manual: true })
      runners.push(fake)
      return fake.runner
    },
  })

  await acp.client({ name: "active" }).connectWith(agent.app, async (ctx) => {
    await ctx.request(acp.methods.agent.session.resume, { sessionId: "s-1", cwd: "/workspace" })
    const turn = ctx.request(acp.methods.agent.session.prompt, {
      sessionId: "s-1",
      prompt: [{ type: "text", text: "x" }],
    })
    // The runner is created lazily on the first prompt; wait for it.
    await until(() => runners.length > 0)
    await runners[0]!.entered

    // Active: delete must refuse and leave history intact.
    await expect(ctx.request(acp.methods.agent.session.delete, { sessionId: "s-1" })).rejects.toBeDefined()
    expect(store.get("s-1")).not.toBeNull()

    // Close cancels the in-flight turn and frees the attachment.
    await ctx.request(acp.methods.agent.session.close, { sessionId: "s-1" })
    await expect(turn).resolves.toEqual({ stopReason: "cancelled" })
    expect(runners[0]!.cancelled).toEqual(["s-1"])
    expect(agent.sessions.isActive("s-1")).toBe(false)

    // Now idle: delete succeeds and the history is gone.
    await ctx.request(acp.methods.agent.session.delete, { sessionId: "s-1" })
    expect(store.get("s-1")).toBeNull()
    const listed = await ctx.request(acp.methods.agent.session.list, {})
    expect(listed.sessions).toEqual([])
  })
})

test("session/load replays history to the client and capabilities match the handlers", async () => {
  const store = new MemorySessionStore()
  createSession({ id: "s-1", directory: "/workspace" }, store)
  saveUserMessage({ sessionId: "s-1", text: "hi", store })
  const assistant = createAssistantMessage({ sessionId: "s-1", store })
  addPart({ messageId: assistant.id, sessionId: "s-1", type: "text", data: { text: "hello" }, store })

  const runners: Array<ReturnType<typeof makeFakeRunner>> = []
  const agent = createAcpAgent({
    store,
    createRunner: (_cwd, s) => {
      const fake = makeFakeRunner(s)
      runners.push(fake)
      return fake.runner
    },
  })

  const seen: acp.SessionNotification[] = []
  const clientApp = acp
    .client({ name: "loader" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      seen.push(params)
    })

  await clientApp.connectWith(agent.app, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    })
    expect(init.agentCapabilities?.loadSession).toBe(true)
    expect(init.agentCapabilities?.sessionCapabilities).toEqual({
      list: {},
      delete: {},
      resume: {},
      close: {},
    })

    await ctx.request(acp.methods.agent.session.load, {
      sessionId: "s-1",
      cwd: "/workspace",
      mcpServers: [],
    })
    expect(seen.map((n) => n.update.sessionUpdate)).toEqual(["user_message_chunk", "agent_message_chunk"])

    // A prompt after load resumes the same persisted session.
    await ctx.request(acp.methods.agent.session.prompt, {
      sessionId: "s-1",
      prompt: [{ type: "text", text: "more" }],
    })
    expect(runners[0]!.prompts[0]!.sessionId).toBe("s-1")
  })
})
