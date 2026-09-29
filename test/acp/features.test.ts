// QUA-245 self-check: ACP stdio MCP integration, safe permissions, images.
//
// Three release gates, one file:
//   * stdio MCP — a real child process (test/acp/fixtures/mcp-echo-server.mjs)
//     is discovered, its tool invoked, and it is killed on teardown; the
//     session bridge injects the discovered tools into the runner and fails
//     closed when a server cannot connect.
//   * permissions — a denied tool throws out of `tool.execute.before` (the
//     engine's pre-execution seam) so it never runs; `question` is refused;
//     allow_always is cached per session; an aborted turn does not hang.
//   * images — capability advertisement and `RunnerPromptInput.images` mapping
//     are toggled together.
//
// Kept in `test/acp` (package root) so the real SDK is loaded: the package-local
// `packages/acp/test/sessions.test.ts` globally mocks `@agentclientprotocol/sdk`.

import { expect, test } from "bun:test"
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import * as acp from "@agentclientprotocol/sdk"
import { createHookRegistry, MemorySessionStore, type Runner, type SessionStore, type ToolDef } from "@quark/runner"
import { connectMcpServer, connectStdioServers, requireStdio } from "../../packages/acp/src/mcp"
import { createSessionHandlers } from "../../packages/acp/src/sessions"
import { createPermissionBridge } from "../../packages/acp/src/permissions"
import { createAcpAgent } from "../../packages/acp/src/index"

const FIXTURE = new URL("./fixtures/mcp-echo-server.mjs", import.meta.url).pathname
const ECHO_SERVER = { name: "echo", command: process.execPath, args: [FIXTURE], env: [] }
const ctx = () => ({ abort: new AbortController().signal }) as never

// ---------------------------------------------------------------------------
// Fake runner: a real hook registry + bus so the update/permission bridges can
// wire into it, and a `prompt` that records the input the bridge produced.
// ---------------------------------------------------------------------------

type Listener = (data: any) => void

function makeRecordingRunner(store?: SessionStore) {
  const prompts: any[] = []
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
    async prompt(input: { sessionId?: string }) {
      prompts.push(input)
      // Honor a supplied persisted id rather than minting a competing one.
      const sessionId = input.sessionId ?? "runner-1"
      emit("session-created", { sessionId })
      return { sessionId }
    },
    cancel() {},
    isActive: () => false,
    hasActiveRun: () => false,
  }
  return { runner: runner as unknown as Runner, prompts }
}

// ---------------------------------------------------------------------------
// stdio MCP client
// ---------------------------------------------------------------------------

test("stdio MCP: discovers tools, invokes them, and tears the child down", async () => {
  const connection = await connectMcpServer(ECHO_SERVER as never, { log: () => {} })
  try {
    expect(connection.name).toBe("echo")
    expect(connection.tools.map((tool) => tool.id)).toEqual(["mcp__echo__echo"])
    const [echo] = connection.tools as [ToolDef]
    expect(echo.description).toBe("Echo the given text")
    // The JSON Schema survived JSON Schema -> zod -> runner.
    expect(echo.parameters.safeParse({ text: "hi" }).success).toBe(true)
    expect(echo.parameters.safeParse({ text: 1 }).success).toBe(false)

    const result = await echo.execute({ text: "hi" }, ctx())
    expect(result.output).toBe("hi")
    expect(result.metadata).toEqual({ server: "echo" })
  } finally {
    await connection.dispose()
  }
  // Teardown rejects further calls: the child is gone, not merely ignored.
  await expect(connection.tools[0]!.execute({ text: "x" }, ctx())).rejects.toThrow()
})

test("stdio MCP: a server that never answers fails closed on timeout", async () => {
  const started = Date.now()
  await expect(
    connectMcpServer({ name: "cat", command: "/bin/cat", args: [], env: [] } as never, {
      requestTimeoutMs: 200,
      log: () => {},
    }),
  ).rejects.toThrow(/timed out/)
  expect(Date.now() - started).toBeLessThan(5_000)
})

test("stdio MCP: a failing server rolls back the ones already connected", async () => {
  const children: ChildProcess[] = []
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    const child = nodeSpawn(command, args as string[], options as never)
    children.push(child)
    return child
  }) as never
  await expect(
    connectStdioServers(
      [
        ECHO_SERVER as never,
        { name: "dead", command: "/usr/bin/false", args: [], env: [] } as never,
      ],
      { spawn, log: () => {} },
    ),
  ).rejects.toBeDefined()
  expect(children).toHaveLength(2)
  // Rollback awaited the first child's exit.
  expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true)
})

test("requireStdio refuses non-stdio transports and relative commands", () => {
  expect(() => requireStdio({ type: "http", name: "h", url: "http://x", headers: [] } as never)).toThrow(/MCP/)
  expect(() => requireStdio({ type: "sse", name: "s", url: "http://x", headers: [] } as never)).toThrow(/MCP/)
  expect(() => requireStdio({ name: "missing-command" } as never)).toThrow(/MCP/)
  expect(() => requireStdio({ name: "rel", command: "./server", args: [], env: [] } as never)).toThrow(/absolute/)
})

// ---------------------------------------------------------------------------
// Session bridge MCP wiring
// ---------------------------------------------------------------------------

test("session/new connects stdio MCP servers and injects their tools into the runner", async () => {
  let captured: ToolDef[] = []
  const store = new MemorySessionStore()
  const { runner } = makeRecordingRunner(store)
  const bridge = createSessionHandlers({
    store,
    createRunner: (_cwd, tools) => {
      captured = tools
      return runner
    },
  })

  const { sessionId } = await bridge.newSession({ cwd: "/workspace", mcpServers: [ECHO_SERVER] } as never)
  await bridge.prompt(
    { sessionId, prompt: [{ type: "text", text: "hi" }] } as never,
    { signal: new AbortController().signal, client: {} as never },
  )

  expect(captured.map((tool) => tool.id)).toEqual(["mcp__echo__echo"])
  const [echo] = captured as [ToolDef]
  expect((await echo.execute({ text: "bridge" }, ctx())).output).toBe("bridge")

  // close() must kill the child: the tool can no longer reach it.
  bridge.close({ sessionId })
  await expect(echo.execute({ text: "after" }, ctx())).rejects.toThrow()
})

test("re-adopting a session disposes redundant MCP connections", async () => {
  const { runner } = makeRecordingRunner()
  const bridge = createSessionHandlers({ store: new MemorySessionStore(), createRunner: () => runner })
  const disposed: string[] = []
  const connection = (name: string) => ({
    name,
    tools: [],
    dispose: async () => { disposed.push(name) },
  })
  bridge.adopt({ acpSessionId: "persisted", runnerSessionId: "persisted", cwd: "/workspace", mcp: [connection("first")] })
  bridge.adopt({ acpSessionId: "persisted", runnerSessionId: "persisted", cwd: "/workspace", mcp: [connection("redundant")] })
  expect(disposed).toEqual(["redundant"])
  bridge.close({ sessionId: "persisted" })
  expect(disposed).toEqual(["redundant", "first"])
})

test("session/new fails closed when an MCP server cannot be reached", async () => {
  const bridge = createSessionHandlers({ store: new MemorySessionStore(), createRunner: () => makeRecordingRunner().runner })
  await expect(
    bridge.newSession({
      cwd: "/workspace",
      mcpServers: [{ name: "dead", command: "/usr/bin/false", args: [], env: [] }],
    } as never),
  ).rejects.toMatchObject({ code: -32602 })
})

test("session/new refuses HTTP MCP transports instead of dropping them", () => {
  const bridge = createSessionHandlers({ store: new MemorySessionStore(), createRunner: () => makeRecordingRunner().runner })
  expect(() =>
    bridge.newSession({
      cwd: "/workspace",
      mcpServers: [{ type: "http", name: "h", url: "http://x", headers: [] }],
    } as never),
  ).toThrow(/MCP/)
})

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function fireBefore(runner: Runner, tool: string, args: Record<string, unknown> = {}, callId = "call-1") {
  return runner.hooks.fire("tool.execute.before", { tool, args, sessionId: "r-1", callId }, { args })
}

function turn(
  runner: Runner,
  client: unknown,
  signal = new AbortController().signal,
  acpSessionId = "s-1",
) {
  return { acpSessionId, runnerSessionId: "r-1", runner, signal, client } as never
}

test("permission gate: a denied tool throws before it can execute", async () => {
  const { runner } = makeRecordingRunner()
  const client = {
    request: async (method: string, params: any) => {
      expect(method).toBe(acp.methods.client.session.requestPermission)
      expect(params.sessionId).toBe("s-1")
      expect(params.toolCall).toMatchObject({ status: "pending", rawInput: { filePath: "/x" } })
      // QUA-265: the permission card carries the remapped ACP id, not "call-1".
      expect(params.toolCall.toolCallId).toBeTruthy()
      expect(params.toolCall.toolCallId).not.toBe("call-1")
      expect(params.options.map((option: any) => option.kind)).toEqual([
        "allow_once",
        "allow_always",
        "reject_once",
        "reject_always",
      ])
      return { outcome: { outcome: "selected", optionId: "reject_once" } }
    },
  }
  createPermissionBridge({ log: () => {} }).onTurnStart(turn(runner, client))

  await expect(fireBefore(runner, "write", { filePath: "/x" })).rejects.toThrow(/permission denied/)
})

test("permission gate: allow_once runs, safe tools never prompt, question is refused", async () => {
  const { runner } = makeRecordingRunner()
  let calls = 0
  const client = {
    request: async () => {
      calls++
      return { outcome: { outcome: "selected", optionId: "allow_once" } }
    },
  }
  createPermissionBridge({ log: () => {} }).onTurnStart(turn(runner, client))

  await expect(fireBefore(runner, "bash", { command: "ls" })).resolves.toBeDefined()
  expect(calls).toBe(1)

  // Read-only tools are baseline-safe: no round trip.
  await fireBefore(runner, "read", { filePath: "/a" })
  expect(calls).toBe(1)

  // Network URLs can carry workspace secrets; require explicit approval.
  await fireBefore(runner, "webfetch", { url: "https://example.test/?secret=contents" })
  await fireBefore(runner, "websearch", { query: "workspace contents" })
  expect(calls).toBe(3)

  // `question` has no ACP responder; refusing it prevents an indefinite hang.
  await expect(fireBefore(runner, "question", { questions: [] })).rejects.toThrow(/unavailable over ACP/)
  expect(calls).toBe(3)
})

test("permission gate: allow_always is cached per session, not per call", async () => {
  const { runner } = makeRecordingRunner()
  let calls = 0
  const client = {
    request: async () => {
      calls++
      return { outcome: { outcome: "selected", optionId: "allow_always" } }
    },
  }
  createPermissionBridge({ log: () => {} }).onTurnStart(turn(runner, client))

  await fireBefore(runner, "bash")
  await fireBefore(runner, "bash")
  expect(calls).toBe(1)
})

test("permission gate: an aborted turn rejects instead of hanging on the client", async () => {
  const { runner } = makeRecordingRunner()
  const controller = new AbortController()
  const client = { request: () => new Promise(() => {}) }
  createPermissionBridge({ log: () => {} }).onTurnStart(turn(runner, client, controller.signal))

  const pending = fireBefore(runner, "bash")
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
})

test("permission gate: a transport failure denies rather than allows", async () => {
  const { runner } = makeRecordingRunner()
  const client = {
    request: async () => {
      throw new Error("transport down")
    },
  }
  createPermissionBridge({ log: () => {} }).onTurnStart(turn(runner, client))
  await expect(fireBefore(runner, "bash")).rejects.toThrow(/permission denied/)
})

test("permission gate: two sessions keep independent clients and decisions", async () => {
  const a = makeRecordingRunner()
  const b = makeRecordingRunner()
  const seen: string[] = []
  const clientA = {
    request: async (_method: string, params: any) => {
      seen.push(`a:${params.sessionId}`)
      return { outcome: { outcome: "selected", optionId: "allow_once" } }
    },
  }
  const clientB = {
    request: async (_method: string, params: any) => {
      seen.push(`b:${params.sessionId}`)
      return { outcome: { outcome: "selected", optionId: "reject_once" } }
    },
  }
  const bridge = createPermissionBridge({ log: () => {} })
  bridge.onTurnStart(turn(a.runner, clientA, undefined, "session-a"))
  bridge.onTurnStart(turn(b.runner, clientB, undefined, "session-b"))

  await expect(fireBefore(a.runner, "bash")).resolves.toBeDefined()
  await expect(fireBefore(b.runner, "bash")).rejects.toThrow(/permission denied/)
  expect(seen).toEqual(["a:session-a", "b:session-b"])
})

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

test("images: capability advertisement and block mapping move together", async () => {
  const store = new MemorySessionStore()
  const { runner, prompts } = makeRecordingRunner(store)
  const agent = createAcpAgent({ store, createRunner: () => runner, images: true, log: () => {} })

  await acp.client({ name: "img" }).connectWith(agent.app, async (client) => {
    const init = await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
    expect(init.agentCapabilities?.promptCapabilities).toEqual({ image: true })

    const { sessionId } = await client.request(acp.methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [],
    })
    await client.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [
        { type: "image", mimeType: "image/png", data: "AAAA" },
        { type: "text", text: "describe" },
      ],
    })

    expect(prompts[0]!.images).toEqual([{ mime: "image/png", data: "AAAA" }])
    expect(prompts[0]!.parts).toEqual([{ type: "text", text: "describe" }])
  })
})

test("images option B: known non-vision model rejects image prompt, text remains usable", async () => {
  const store = new MemorySessionStore()
  const { runner, prompts } = makeRecordingRunner(store)
  const agent = createAcpAgent({ store, createRunner: () => runner, images: true, imageSupport: false, log: () => {} })

  await acp.client({ name: "blind-model" }).connectWith(agent.app, async (client) => {
    const init = await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
    expect(init.agentCapabilities?.promptCapabilities?.image).toBe(true)
    const { sessionId } = await client.request(acp.methods.agent.session.new, {
      cwd: process.cwd(), mcpServers: [],
    })
    await expect(client.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "image", mimeType: "image/png", data: "AAAA" }, { type: "text", text: "describe" }],
    })).rejects.toMatchObject({ code: -32602, message: expect.stringContaining("does not accept image input") })
    expect(prompts).toHaveLength(0)
    await client.request(acp.methods.agent.session.prompt, {
      sessionId, prompt: [{ type: "text", text: "hello" }],
    })
    expect(prompts).toHaveLength(1)
  })
})

test("images option B: an unknown model passes images through to the provider", async () => {
  const store = new MemorySessionStore()
  const { runner, prompts } = makeRecordingRunner(store)
  const agent = createAcpAgent({ store, createRunner: () => runner, images: true, log: () => {} })
  await acp.client({ name: "unknown-model" }).connectWith(agent.app, async (client) => {
    const { sessionId } = await client.request(acp.methods.agent.session.new, {
      cwd: process.cwd(), mcpServers: [],
    })
    await client.request(acp.methods.agent.session.prompt, {
      sessionId, prompt: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
    })
    expect(prompts[0]!.images).toEqual([{ mime: "image/png", data: "AAAA" }])
  })
})

test("images: without the opt-in the capability is absent and the block refused", async () => {
  const store = new MemorySessionStore()
  const { runner } = makeRecordingRunner(store)
  const agent = createAcpAgent({ store, createRunner: () => runner, log: () => {} })

  await acp.client({ name: "no-img" }).connectWith(agent.app, async (client) => {
    const init = await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
    expect(init.agentCapabilities?.promptCapabilities).toBeUndefined()

    const { sessionId } = await client.request(acp.methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [],
    })
    await expect(
      client.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
      }),
    ).rejects.toMatchObject({ code: -32602 })
  })
})
