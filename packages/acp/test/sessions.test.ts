// Focused tests for the ACP session bridge (QUA-248).
//
// The official SDK is not installed in this checkout yet (QUA-242 owns
// package.json), so its `methods`/`RequestError` surface is mocked by shape.
// The ACP App is a fake that records handlers; runners are fakes with a real
// `bus` and a controllable `prompt`.

import { expect, mock, test } from "bun:test"

mock.module("@agentclientprotocol/sdk", () => ({
  methods: {
    agent: {
      session: { new: "session/new", prompt: "session/prompt", cancel: "session/cancel" },
    },
    client: { session: { update: "session/update" } },
  },
  RequestError: class RequestError extends Error {
    code: number
    data: unknown
    constructor(code: number, message: string, data?: unknown) {
      super(message)
      this.code = code
      this.data = data
    }
    static invalidParams(data?: unknown, additionalMessage?: string) {
      return new RequestError(
        -32602,
        `Invalid params${additionalMessage ? `: ${additionalMessage}` : ""}`,
        data,
      )
    }
  },
}))

const { createSessionHandlers, registerSessions } = await import("../src/sessions")

type Wire = { sessionId: string; prompt: Array<Record<string, unknown>> }

function makeRunner(options: { sessionId?: string; manual?: boolean } = {}) {
  const calls: Record<string, any>[] = []
  const cancelled: string[] = []
  const listeners = new Map<string, Set<(data: any) => void>>()
  const gates: Array<() => void> = []

  const runner: Record<string, any> = {
    bus: {
      on(name: string, fn: (data: any) => void) {
        const set = listeners.get(name) ?? new Set()
        set.add(fn)
        listeners.set(name, set)
      },
      off(name: string, fn: (data: any) => void) {
        listeners.get(name)?.delete(fn)
      },
      emit(name: string, data: any) {
        for (const fn of listeners.get(name) ?? []) fn(data)
      },
    },
    prompt(input: Record<string, any>) {
      calls.push(input)
      const sessionId = (input.sessionId as string | undefined) ?? options.sessionId ?? "runner-1"
      // The real engine announces creation synchronously, before awaiting.
      runner.bus.emit("session-created", { sessionId })
      if (options.manual) {
        return new Promise<{ sessionId: string }>((resolve) => {
          gates.push(() => resolve({ sessionId }))
        })
      }
      return Promise.resolve({ sessionId })
    },
    cancel(id: string) {
      cancelled.push(id)
    },
    isActive: () => false,
    hasActiveRun: () => false,
  }
  return { runner, calls, cancelled, release: () => gates.splice(0).forEach((g) => g()) }
}

const callCtx = () => ({ signal: new AbortController().signal, client: {} as any })
const newSessionParams = (over: Record<string, unknown> = {}) => ({ cwd: "/workspace", mcpServers: [], ...over }) as any

test("session/new allocates unique ids and defers runner creation", () => {
  const created: string[] = []
  const { runner } = makeRunner()
  const bridge = createSessionHandlers({ createRunner: (cwd) => (created.push(cwd), runner as any) })

  const a = bridge.newSession(newSessionParams())
  const b = bridge.newSession(newSessionParams({ cwd: "/other" }))
  expect(a.sessionId).not.toBe(b.sessionId)
  expect(created).toEqual([])
})

test("session/new rejects MCP servers and additional directories explicitly", () => {
  const bridge = createSessionHandlers({ createRunner: () => makeRunner().runner as any })
  expect(() => bridge.newSession(newSessionParams({ mcpServers: [{ name: "x" }] }))).toThrow(/MCP/)
  expect(() => bridge.newSession(newSessionParams({ additionalDirectories: ["/x"] }))).toThrow(
    /additionalDirectories/,
  )
})

test("prompt maps ACP id to runner id, passes cwd, and supports multiple turns", async () => {
  const { runner, calls } = makeRunner({ sessionId: "runner-42" })
  const bridge = createSessionHandlers({ createRunner: () => runner as any })
  const { sessionId } = bridge.newSession(newSessionParams())
  const ctx = callCtx()

  const first = await bridge.prompt(
    {
      sessionId,
      prompt: [
        { type: "text", text: "hello" },
        { type: "resource_link", name: "a.ts", uri: "file:///a.ts" },
      ],
    } as any,
    ctx,
  )
  expect(first.stopReason).toBe("end_turn")
  expect(calls[0]!.targetWorkspace).toBe("/workspace")
  expect(calls[0]!.sessionId).toBeUndefined()
  expect(calls[0]!.parts[0]).toEqual({ type: "text", text: "hello" })
  expect(calls[0]!.parts[1].text).toContain("file:///a.ts")

  await bridge.prompt({ sessionId, prompt: [{ type: "text", text: "again" }] } as any, ctx)
  expect(calls[1]!.sessionId).toBe("runner-42")
  expect(bridge.runnerSessionId(sessionId)).toBe("runner-42")
})

test("unknown session and unsupported prompt blocks are rejected", async () => {
  const { runner, calls } = makeRunner()
  const bridge = createSessionHandlers({ createRunner: () => runner as any })
  const ctx = callCtx()
  await expect(bridge.prompt({ sessionId: "nope", prompt: [{ type: "text", text: "x" }] } as any, ctx)).rejects.toThrow(
    /unknown session/,
  )

  const { sessionId } = bridge.newSession(newSessionParams())
  await expect(
    bridge.prompt({ sessionId, prompt: [{ type: "image", mimeType: "image/png", data: "..." }] } as any, ctx),
  ).rejects.toThrow(/unsupported prompt content block "image"/)
  expect(calls).toEqual([])
})

test("concurrent prompts on one session are rejected until the turn ends", async () => {
  const { runner, release } = makeRunner({ manual: true })
  const bridge = createSessionHandlers({ createRunner: () => runner as any })
  const { sessionId } = bridge.newSession(newSessionParams())
  const ctx = callCtx()

  const running = bridge.prompt({ sessionId, prompt: [{ type: "text", text: "one" }] } as any, ctx)
  await expect(bridge.prompt({ sessionId, prompt: [{ type: "text", text: "two" }] } as any, ctx)).rejects.toThrow(
    /already in progress/,
  )

  release()
  await running
  // Idle again: a fresh turn is accepted.
  const next = bridge.prompt({ sessionId, prompt: [{ type: "text", text: "three" }] } as any, ctx)
  release()
  await expect(next).resolves.toEqual({ stopReason: "end_turn" })
})

test("cancel targets the runner session and reports a cancelled stop reason", async () => {
  const { runner, cancelled, release } = makeRunner({ sessionId: "runner-7", manual: true })
  const bridge = createSessionHandlers({ createRunner: () => runner as any })
  const { sessionId } = bridge.newSession(newSessionParams())
  const running = bridge.prompt({ sessionId, prompt: [{ type: "text", text: "stop me" }] } as any, callCtx())

  bridge.cancel({ sessionId })
  expect(cancelled).toEqual(["runner-7"])
  release()
  await expect(running).resolves.toEqual({ stopReason: "cancelled" })
})

test("onTurnStart receives the runner and ACP client context", async () => {
  const { runner } = makeRunner()
  const turns: any[] = []
  const bridge = createSessionHandlers({
    createRunner: () => runner as any,
    onTurnStart: (turn) => turns.push(turn),
  })
  const { sessionId } = bridge.newSession(newSessionParams())
  const ctx = callCtx()
  await bridge.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] } as any, ctx)

  expect(turns).toHaveLength(1)
  expect(turns[0]!.runner).toBe(runner)
  expect(turns[0]!.client).toBe(ctx.client)
  expect(turns[0]!.acpSessionId).toBe(sessionId)
})

test("dispose cancels active turns and is idempotent", async () => {
  const { runner, cancelled, release } = makeRunner({ sessionId: "runner-9", manual: true })
  const bridge = createSessionHandlers({ createRunner: () => runner as any })
  const { sessionId } = bridge.newSession(newSessionParams())
  const running = bridge.prompt({ sessionId, prompt: [{ type: "text", text: "x" }] } as any, callCtx())

  bridge.dispose()
  expect(cancelled).toEqual(["runner-9"])
  expect(bridge.runnerSessionId(sessionId)).toBeNull()
  release()
  await running
  bridge.dispose()
})

test("registerSessions installs session/new and session/prompt on the app", async () => {
  const { runner } = makeRunner()
  const handlers = new Map<string, (ctx: any) => Promise<any> | any>()
  const app = {
    onRequest(method: string, handler: (ctx: any) => Promise<any> | any) {
      handlers.set(method, handler)
      return app
    },
  }
  const bridge = registerSessions(app as any, { createRunner: () => runner as any })
  expect([...handlers.keys()]).toEqual(["session/new", "session/prompt"])

  const created = await handlers.get("session/new")!({ params: newSessionParams() })
  const response = await handlers.get("session/prompt")!({
    params: { sessionId: created.sessionId, prompt: [{ type: "text", text: "via app" }] } as Wire,
    signal: new AbortController().signal,
    client: {},
  })
  expect(response).toEqual({ stopReason: "end_turn" })
  expect(bridge.runnerSessionId(created.sessionId)).toBe("runner-1")
})
