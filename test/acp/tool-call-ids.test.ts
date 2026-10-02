// QUA-265 self-check: ACP tool-call ids are unique per session.
//
// Providers (Gemini via the AI SDK, OpenAI-compatible gateways) restart their
// tool-call ids every turn (`call_0`, `call_1`, …), and replay reuses the
// persisted id. ACP clients key tool cards by `toolCallId`, so a repeated id
// mutates a stale card. The remap lives ONLY at the ACP boundary; the persisted
// `PartRow.data.callId` (fed back to the provider) must stay the raw id.
//
// Kept in `test/acp` (package root) so the real SDK is loaded: the package-local
// `packages/acp/test/sessions.test.ts` globally mocks `@agentclientprotocol/sdk`.

import { expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { MemorySessionStore, createHookRegistry, createSession, type Runner, type SessionStore } from "@quark/runner"
import { addPart, createAssistantMessage, toModelMessages } from "@quark/runner/session/message"
import { createAcpAgent } from "../../packages/acp/src/index"
import { createToolCallIds } from "../../packages/acp/src/tool-call-ids"
import { historyToUpdates } from "../../packages/acp/src/updates"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ACP tool-call id of a tool update, or undefined for other updates. */
function toolCallIdOf(update: acp.SessionUpdate): string | undefined {
  switch (update.sessionUpdate) {
    case "tool_call":
    case "tool_call_update":
      return update.toolCallId
    default:
      return undefined
  }
}

function toolCallIdsOf(updates: acp.SessionUpdate[]): string[] {
  return updates.map(toolCallIdOf).filter((id): id is string => typeof id === "string")
}

/** The single non-empty ACP id shared by every tool update in a turn. */
function soleToolCallId(updates: acp.SessionUpdate[]): string {
  const ids = toolCallIdsOf(updates)
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(1)
  expect(ids[0]).toBeTruthy()
  return ids[0]!
}

type Listener = (data: any) => void

/**
 * Scripted runner than emits a full tool lifecycle selected by the prompt text,
 * with a controllable RAW provider call id so the ACP remap can be observed:
 *   * "TOOL <raw>"   -> tool-start/input/running/end with callId <raw>
 *   * "PERM <raw>"   -> like TOOL but fires the permission hook (client-gated)
 *   * "ORPHAN <raw>" -> input/end only, no tool-start (raw id never seen first)
 * It persists the tool part with the RAW id, exactly as the real engine does.
 */
function makeToolRunner(store: SessionStore): Runner {
  const listeners = new Map<string, Set<Listener>>()
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
    hooks: createHookRegistry(),
    store,
    async prompt(input: { sessionId?: string; parts: { type: "text"; text: string }[] }) {
      const sessionId = input.sessionId ?? "runner-1"
      if (!store.get(sessionId)) createSession({ id: sessionId, directory: "/workspace" }, store)
      emit("session-created", { sessionId })
      const text = input.parts.map((part) => part.text).join(" ")
      const raw = /(?:TOOL|ORPHAN|PERM)\s+(\S+)/.exec(text)?.[1] ?? "call_0"
      emit("text-delta", { sessionId, messageId: "m1", partId: "p1", delta: text, text })
      const messageId = createAssistantMessage({ sessionId, store }).id

      if (text.includes("ORPHAN")) {
        emit("tool-input", { sessionId, messageId, partId: "orphan", tool: "read", callId: raw, input: {} })
        emit("tool-end", {
          sessionId,
          messageId,
          partId: "orphan",
          tool: "read",
          callId: raw,
          status: "completed",
          output: "orphan",
        })
        return { sessionId }
      }

      if (text.includes("TOOL") || text.includes("PERM")) {
        const permission = text.includes("PERM")
        const tool = permission ? "bash" : "read"
        const args = permission ? { command: "ls" } : { filePath: "/tmp/a.ts" }
        emit("tool-start", { sessionId, messageId, partId: "t1", tool, callId: raw })
        emit("tool-input", { sessionId, messageId, partId: "t1", tool, callId: raw, input: args })
        if (permission) {
          // QUA-266: authorization precedes "running"; the request resolves only
          // after the client answers, and must reuse the tool-start card id.
          await runner.hooks.fire("tool.execute.before", { tool, args, sessionId, callId: raw }, { args })
        }
        emit("tool-running", { sessionId, messageId, callId: raw })
        emit("tool-end", {
          sessionId,
          messageId,
          partId: "t1",
          tool,
          callId: raw,
          status: "completed",
          output: "contents",
        })
        // The real engine persists the RAW provider id; the ACP remap must never
        // reach storage (message.ts feeds this back as `toolCallId`).
        addPart({
          messageId,
          sessionId,
          type: "tool",
          data: { tool, callId: raw, status: "completed", input: args, output: "contents" },
          store,
        })
      }
      return { sessionId }
    },
    cancel() {},
    isActive: () => false,
    hasActiveRun: () => false,
  }
  return runner as unknown as Runner
}

// ---------------------------------------------------------------------------
// Registry unit tests
// ---------------------------------------------------------------------------

test("tool-call ids: stable within a turn, unique across turns and replay", () => {
  const registry = createToolCallIds()

  const turn1 = registry.startTurn()
  const first = turn1.forRaw("call_0")
  expect(first).toBeTruthy()
  expect(turn1.forRaw("call_0")).toBe(first) // same raw id -> same ACP id

  const turn2 = registry.startTurn()
  const second = turn2.forRaw("call_0")
  expect(second).not.toBe(first) // same raw id, new turn -> new ACP id

  const replay = registry.fresh()
  const replay2 = registry.fresh()
  expect(new Set([first, second, replay, replay2]).size).toBe(4)
})

test("replay mints a fresh id per stored row: two rows that both persisted call_0 diverge", () => {
  const store = new MemorySessionStore()
  createSession({ directory: "/workspace", id: "s-replay" }, store)
  const assistant = createAssistantMessage({ sessionId: "s-replay", store })
  for (const tool of ["read", "write"]) {
    addPart({
      messageId: assistant.id,
      sessionId: "s-replay",
      type: "tool",
      data: { tool, callId: "call_0", status: "completed", input: {}, output: "ok" },
      store,
    })
  }

  const updates = historyToUpdates(store.replay("s-replay"), createToolCallIds())
  const ids = toolCallIdsOf(updates)
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2) // distinct cards despite the shared raw id
  expect(ids).not.toContain("call_0") // raw ids are never forwarded
})

// ---------------------------------------------------------------------------
// Live wire behavior through the composition root
// ---------------------------------------------------------------------------

/** Build a client over `agent`, collect every session update, run `op`. */
function connect(
  agent: ReturnType<typeof createAcpAgent>,
  op: (ctx: acp.ClientContext, seen: acp.SessionUpdate[], permissions: acp.RequestPermissionRequest[]) => Promise<void>,
) {
  const seen: acp.SessionUpdate[] = []
  const permissions: acp.RequestPermissionRequest[] = []
  return acp
    .client({ name: "tool-ids" })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      seen.push(params.update)
    })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      permissions.push(params)
      return { outcome: { outcome: "selected", optionId: "allow_once" } }
    })
    .connectWith(agent.app, (ctx) => op(ctx, seen, permissions))
}

test("two turns reusing raw call_0 get distinct ACP ids; one turn keeps one id throughout", async () => {
  const store = new MemorySessionStore()
  const agent = createAcpAgent({ store, createRunner: () => makeToolRunner(store), log: () => {} })

  await connect(agent, async (ctx, seen) => {
    const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
      cwd: "/workspace",
      mcpServers: [],
    })
    const runTurn = async (text: string) => {
      const start = seen.length
      await ctx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] })
      return seen.slice(start)
    }

    const turn1 = await runTurn("TOOL call_0")
    const turn2 = await runTurn("TOOL call_0")

    // Full lifecycle, one id across tool_call -> input -> running -> completed.
    expect(turn1.map((u) => u.sessionUpdate)).toEqual([
      "agent_message_chunk",
      "tool_call",
      "tool_call_update",
      "tool_call_update",
      "tool_call_update",
    ])
    const id1 = soleToolCallId(turn1)
    const id2 = soleToolCallId(turn2)
    expect(id1).not.toBe(id2) // turn 2 never mutates turn 1's card
    expect(id1).not.toBe("call_0")
    expect(id2).not.toBe("call_0")

    // Persisted ids stay raw, so the next provider request carries the original.
    const { messages, parts } = store.replay(sessionId)
    const raw = parts.filter((part) => part.type === "tool").map((part) => JSON.parse(part.data).callId)
    expect(raw).toEqual(["call_0", "call_0"])
    const provider = JSON.stringify(toModelMessages(messages, parts))
    expect(provider).toContain('"call_0"')
    expect(provider).not.toContain("quark-tool-") // the ACP remap never leaked
  })
})

test("an update for a raw id never seen this turn gets one stable new id, never dropped", async () => {
  const store = new MemorySessionStore()
  const agent = createAcpAgent({ store, createRunner: () => makeToolRunner(store), log: () => {} })

  await connect(agent, async (ctx, seen) => {
    const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
      cwd: "/workspace",
      mcpServers: [],
    })
    const start = seen.length
    await ctx.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: "ORPHAN call_7" }],
    })
    const turn = seen.slice(start)
    const ids = toolCallIdsOf(turn)
    expect(ids).toHaveLength(2) // tool-input and tool-end, neither dropped
    expect(new Set(ids).size).toBe(1) // both reuse one freshly-minted id
    expect(ids[0]).toBeTruthy()
    expect(ids[0]).not.toBe("call_7")
  })
})

test("session/request_permission targets the tool card's ACP id", async () => {
  const store = new MemorySessionStore()
  const agent = createAcpAgent({ store, createRunner: () => makeToolRunner(store), log: () => {} })

  await connect(agent, async (ctx, seen, permissions) => {
    const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
      cwd: "/workspace",
      mcpServers: [],
    })
    const start = seen.length
    await ctx.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: "PERM call_0" }],
    })
    const cardId = soleToolCallId(seen.slice(start))

    expect(permissions).toHaveLength(1)
    expect(permissions[0]!.sessionId).toBe(sessionId)
    expect(permissions[0]!.toolCall.toolCallId).toBe(cardId) // same card, not a new one
    expect(cardId).not.toBe("call_0")
  })
})

test("session/load replay ids are distinct and never collide with a later live turn", async () => {
  const store = new MemorySessionStore()
  createSession({ directory: "/workspace", id: "s-load" }, store)
  const assistant = createAssistantMessage({ sessionId: "s-load", store })
  for (const tool of ["read", "write"]) {
    addPart({
      messageId: assistant.id,
      sessionId: "s-load",
      type: "tool",
      data: { tool, callId: "call_0", status: "completed", input: {}, output: "ok" },
      store,
    })
  }
  const agent = createAcpAgent({ store, createRunner: () => makeToolRunner(store), log: () => {} })

  await connect(agent, async (ctx, seen) => {
    await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
    await ctx.request(acp.methods.agent.session.load, {
      sessionId: "s-load",
      cwd: "/workspace",
      mcpServers: [],
    })
    const replayed = toolCallIdsOf(seen)
    expect(replayed).toHaveLength(2)
    expect(new Set(replayed).size).toBe(2) // two stored call_0 rows -> two cards

    const start = seen.length
    await ctx.request(acp.methods.agent.session.prompt, {
      sessionId: "s-load",
      prompt: [{ type: "text", text: "TOOL call_0" }],
    })
    const liveId = soleToolCallId(seen.slice(start))
    expect(replayed).not.toContain(liveId)
  })
})
