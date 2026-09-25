// QUA-247 self-check: persisted session lifecycle
// (session/list, session/resume, session/load, session/delete, session/close).
//
// Real SDK + real MemorySessionStore. The handlers are thin store/bridge
// adapters, so the value here is the mapping, the safety refusals (cwd match,
// active delete, sub-agent ids), the replay order, and that the advertised
// capabilities match exactly what got registered — plus round trips through a
// real client to catch protocol-name drift.

import { expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { MemorySessionStore, createSession } from "@quark/runner"
import type { Session } from "@quark/runner"
import { addPart, createAssistantMessage, saveUserMessage } from "@quark/runner/session/message"
import { createSessionLifecycle, registerLifecycle } from "../../packages/acp/src/lifecycle"
import type { SessionBridge } from "../../packages/acp/src/sessions"

/** Bridge double: records adopt/close, answers `isActive` from `active`. */
function fakeBridge(active: (id: string) => boolean = () => false) {
  const adopted: Array<{ acpSessionId: string; cwd: string; runnerSessionId: string }> = []
  const closed: string[] = []
  const bridge = {
    cancel: () => {},
    adopt: (params: { acpSessionId: string; cwd: string; runnerSessionId: string }) => adopted.push(params),
    close: ({ sessionId }: { sessionId: string }) => closed.push(sessionId),
    isActive: (sessionId: string) => active(sessionId),
  } as unknown as SessionBridge
  return { bridge, adopted, closed }
}

function thrown(fn: () => unknown): acp.RequestError | undefined {
  try {
    fn()
  } catch (failure) {
    return failure as acp.RequestError
  }
  return undefined
}

/** Seed a store with one of each session kind the filters must distinguish. */
function seededStore() {
  const store = new MemorySessionStore()
  const main = createSession({ directory: "/workspace", id: "s-main" }, store)
  store.update(main.id, { title: "Newest", timeUpdated: 3000 })
  const other = createSession({ directory: "/other", id: "s-other" }, store)
  store.update(other.id, { timeUpdated: 2500 })
  const old = createSession({ directory: "/workspace", id: "s-old" }, store)
  store.update(old.id, { timeUpdated: 1000 })
  createSession({ directory: "/workspace", parentSessionId: "s-main", id: "s-child" }, store)
  createSession({ ephemeral: true, directory: "/workspace", id: "s-eph" }, store)
  store.create({
    id: "s-nodir",
    title: null,
    directory: null,
    parentSessionId: null,
    kind: "main",
    summary: null,
    parentSummary: null,
    filesModified: null,
    pinned: false,
    timeCreated: 1,
    timeUpdated: 1,
  } satisfies Session)
  return store
}

test("session/list reports only persisted main sessions, filtered and newest first", () => {
  const lifecycle = createSessionLifecycle(fakeBridge().bridge, { store: seededStore() })

  const { sessions } = lifecycle.listSessions({})
  expect(sessions.map((s) => s.sessionId)).toEqual(["s-main", "s-other", "s-old"])
  expect(sessions[0]).toEqual({
    sessionId: "s-main",
    cwd: "/workspace",
    title: "Newest",
    updatedAt: new Date(3000).toISOString(),
  })
  expect(lifecycle.listSessions({ cwd: "/workspace" }).sessions.map((s) => s.sessionId)).toEqual([
    "s-main",
    "s-old",
  ])
  // Single page: a cursor is never issued, so it must not drop results.
  expect(lifecycle.listSessions({ cursor: "stale" }).sessions).toHaveLength(3)

  // A relative cwd is invalid at the trust boundary.
  const error = thrown(() => lifecycle.listSessions({ cwd: "relative/path" }))
  expect(error).toBeInstanceOf(acp.RequestError)
  expect(error!.code).toBe(-32602)
  expect(error!.data).toEqual({ cwd: "relative/path" })
})

test("session/resume adopts a listed session (no replay) and rejects unsafe requests", () => {
  const store = seededStore()
  const { bridge, adopted } = fakeBridge()
  const lifecycle = createSessionLifecycle(bridge, { store })

  expect(lifecycle.resumeSession({ sessionId: "s-main", cwd: "/workspace" })).toEqual({})
  expect(adopted).toEqual([{ acpSessionId: "s-main", cwd: "/workspace", runnerSessionId: "s-main" }])

  const refused = [
    { sessionId: "nope", cwd: "/workspace" }, // unknown
    { sessionId: "s-child", cwd: "/workspace" }, // sub-agent, never listed
    { sessionId: "s-eph", cwd: "/workspace" }, // ephemeral, never listed
    { sessionId: "s-main", cwd: "relative" }, // non-absolute
    { sessionId: "s-main", cwd: "/elsewhere" }, // workspace mismatch: no silent move
  ]
  for (const params of refused) {
    const error = thrown(() => lifecycle.resumeSession(params))
    expect(error).toBeInstanceOf(acp.RequestError)
    expect(error!.code).toBe(-32602)
  }
  // Only the one successful adopt above.
  expect(adopted).toHaveLength(1)

  // MCP servers / additional directories are refused, never silently dropped.
  expect(thrown(() => lifecycle.resumeSession({ sessionId: "s-main", cwd: "/workspace", mcpServers: [{} as never] }))).toBeInstanceOf(acp.RequestError)
  expect(
    thrown(() => lifecycle.resumeSession({ sessionId: "s-main", cwd: "/workspace", additionalDirectories: ["/x"] })),
  ).toBeInstanceOf(acp.RequestError)
})

test("session/resume refuses a session with an active turn", () => {
  const store = seededStore()
  const { bridge, adopted } = fakeBridge((id) => id === "s-main")
  const lifecycle = createSessionLifecycle(bridge, { store })

  expect(thrown(() => lifecycle.resumeSession({ sessionId: "s-main", cwd: "/workspace" }))).toBeInstanceOf(
    acp.RequestError,
  )
  expect(adopted).toEqual([])
})

test("session/load adopts and replays persisted history as ordered session/update notifications", async () => {
  const store = new MemorySessionStore()
  createSession({ directory: "/workspace", id: "s-1" }, store)
  // Hidden model-only context must never be replayed to the client.
  saveUserMessage({ sessionId: "s-1", text: "hi", modelOnlyText: "SECRET CONTEXT", store })
  const assistant = createAssistantMessage({ sessionId: "s-1", store })
  addPart({ messageId: assistant.id, sessionId: "s-1", type: "text", data: { text: "hello" }, store })
  addPart({
    messageId: assistant.id,
    sessionId: "s-1",
    type: "tool",
    data: { tool: "read", callId: "c1", status: "completed", input: { filePath: "/a.ts" }, output: "contents" },
    store,
  })

  const { bridge, adopted } = fakeBridge()
  const lifecycle = createSessionLifecycle(bridge, { store })
  const notifications: Array<{ method: string; params: any }> = []
  const client = {
    notify: async (method: string, params: any) => {
      notifications.push({ method, params })
    },
  } as unknown as acp.AgentContext

  await lifecycle.loadSession({ sessionId: "s-1", cwd: "/workspace", mcpServers: [] }, client)

  expect(adopted).toEqual([{ acpSessionId: "s-1", cwd: "/workspace", runnerSessionId: "s-1" }])
  expect(notifications.every((n) => n.method === acp.methods.client.session.update)).toBe(true)
  expect(notifications.map((n) => n.params.sessionId)).toEqual(["s-1", "s-1", "s-1"])
  expect(notifications.map((n) => n.params.update.sessionUpdate)).toEqual([
    "user_message_chunk",
    "agent_message_chunk",
    "tool_call",
  ])
  expect(notifications[0]!.params.update).toEqual({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "hi" },
    messageId: expect.any(String),
  })
  // The model-only context part is filtered, not leaked.
  expect(JSON.stringify(notifications)).not.toContain("SECRET CONTEXT")
  expect(notifications[2]!.params.update).toMatchObject({
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    name: "read",
    kind: "read",
    status: "completed",
    rawInput: { filePath: "/a.ts" },
    rawOutput: "contents",
  })
})

test("session/delete evicts an idle session then removes it; active and non-listed are refused", () => {
  const store = seededStore()
  const { bridge, closed } = fakeBridge((id) => id === "s-old")
  const lifecycle = createSessionLifecycle(bridge, { store })

  // Active session: refuse, leave history intact, never evict a live runner.
  expect(thrown(() => lifecycle.deleteSession({ sessionId: "s-old" }))).toBeInstanceOf(acp.RequestError)
  expect(store.get("s-old")).not.toBeNull()
  expect(closed).toEqual([])

  // Idle listed session: evict first, then remove history.
  lifecycle.deleteSession({ sessionId: "s-main" })
  expect(closed).toEqual(["s-main"])
  expect(store.get("s-main")).toBeNull()

  // Only sessions `list` returned are deletable: sub-agents and unknown ids are
  // rejected, and nothing is cancelled/evicted for them.
  for (const sessionId of ["nope", "s-child"]) {
    const error = thrown(() => lifecycle.deleteSession({ sessionId }))
    expect(error).toBeInstanceOf(acp.RequestError)
    expect(error!.code).toBe(-32602)
    expect(error!.data).toEqual({ sessionId })
  }
  expect(store.get("s-child")).not.toBeNull()
  expect(closed).toEqual(["s-main"])
})

test("session/close forwards to the bridge and is idempotent", () => {
  const { bridge, closed } = fakeBridge()
  const lifecycle = createSessionLifecycle(bridge, { store: seededStore() })

  lifecycle.closeSession({ sessionId: "s-main" })
  lifecycle.closeSession({ sessionId: "unknown" })
  expect(closed).toEqual(["s-main", "unknown"])
})

test("registerLifecycle installs all five methods and advertises only those", async () => {
  const app = acp.agent({ name: "lifecycle-test" })
  const lifecycle = registerLifecycle(app, fakeBridge().bridge, { store: seededStore() })

  // The capabilities factory is tied to registration: nothing advertised that
  // is not installed, and nothing installed that is not advertised.
  expect(lifecycle.capabilities).toEqual({
    loadSession: true,
    sessionCapabilities: { list: {}, delete: {}, resume: {}, close: {} },
  })

  await acp.client({ name: "lifecycle-client" }).connectWith(app, async (ctx) => {
    const listed = await ctx.request(acp.methods.agent.session.list, {})
    expect(listed.sessions.map((s) => s.sessionId)).toEqual(["s-main", "s-other", "s-old"])

    const resumed = await ctx.request(acp.methods.agent.session.resume, {
      sessionId: "s-main",
      cwd: "/workspace",
    })
    expect(resumed).toEqual({})

    await ctx.request(acp.methods.agent.session.close, { sessionId: "s-main" })
    await ctx.request(acp.methods.agent.session.delete, { sessionId: "s-old" })
    const after = await ctx.request(acp.methods.agent.session.list, {})
    expect(after.sessions.map((s) => s.sessionId)).toEqual(["s-main", "s-other"])
  })
})
