// QUA-267: teardown must await runner + MCP cleanup instead of force-exiting.
//
// Unit: `dispose()` is an awaitable, idempotent bridge teardown that waits for
// in-flight turns (running their `onTurnEnd`) and MCP disposals.
// Subprocess: EOF mid-turn flushes the queued update before exit, and an MCP
// server that ignores SIGTERM is escalated to SIGKILL before the process exits.

import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import * as acpSdk from "@agentclientprotocol/sdk"
import { MemorySessionStore, type Runner, type SessionStore } from "@quark/runner"
import { createSessionHandlers } from "../../packages/acp/src/sessions"
import { createUpdateBridge } from "../../packages/acp/src/updates"

type Listener = (data: any) => void

/**
 * Fake runner whose turn blocks until the turn's abort controller fires, then
 * settles on demand (`releaseAbort`). `onAbort` lets a test emit a late bus
 * event before the turn settles, to exercise the teardown flush.
 */
function makeRunner(store: SessionStore, options: { onAbort?: (sessionId: string) => void } = {}) {
  const listeners = new Map<string, Set<Listener>>()
  let enteredResolve!: () => void
  const entered = new Promise<void>((resolve) => (enteredResolve = resolve))
  let settle: (() => void) | null = null

  const bus = {
    on(name: string, fn: Listener) {
      const set = listeners.get(name) ?? new Set<Listener>()
      set.add(fn)
      listeners.set(name, set)
    },
    off(name: string, fn: Listener) {
      listeners.get(name)?.delete(fn)
    },
    emit(name: string, data: unknown) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(data)
    },
  }

  const runner = {
    bus,
    store,
    prompt(input: { sessionId?: string; controller: AbortController }) {
      const sessionId = input.sessionId ?? "runner-1"
      bus.emit("session-created", { sessionId })
      enteredResolve()
      return new Promise<{ sessionId: string }>((_resolve, reject) => {
        const finish = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        const onAbort = () => {
          options.onAbort?.(sessionId)
          settle = finish
        }
        if (input.controller.signal.aborted) finish()
        else input.controller.signal.addEventListener("abort", onAbort, { once: true })
      })
    },
    cancel() {},
    isActive: () => false,
    hasActiveRun: () => false,
  }
  return { runner: runner as unknown as Runner, bus, entered, releaseAbort: () => settle?.() }
}

const callCtx = (client: unknown = {}) => ({ signal: new AbortController().signal, client } as never)
const newSession = (bridge: ReturnType<typeof createSessionHandlers>) =>
  bridge.newSession({ cwd: "/workspace", mcpServers: [] } as never)

test("dispose() waits for an in-flight turn that only settles on abort", async () => {
  const store = new MemorySessionStore()
  const { runner, entered, releaseAbort } = makeRunner(store)
  const bridge = createSessionHandlers({ store, createRunner: () => runner, log: () => {} })
  const { sessionId } = newSession(bridge)
  const running = bridge.prompt(
    { sessionId, prompt: [{ type: "text", text: "x" }] } as never,
    callCtx(),
  )
  await entered

  let settled = false
  const disposing = bridge.dispose().then(() => {
    settled = true
  })
  await sleep(10)
  // The abort reached the turn, but the turn has not settled: dispose waits.
  expect(settled).toBe(false)

  releaseAbort()
  await running
  await disposing
  expect(settled).toBe(true)
})

test("dispose() waits for every MCP connection's dispose() to resolve", async () => {
  const store = new MemorySessionStore()
  const bridge = createSessionHandlers({ store, createRunner: () => ({}) as Runner, log: () => {} })
  let releaseMcp!: () => void
  const connection = {
    name: "gated",
    tools: [],
    dispose: () =>
      new Promise<void>((resolve) => {
        releaseMcp = resolve
      }),
  }
  bridge.adopt({ acpSessionId: "s-gated", runnerSessionId: "s-gated", cwd: "/workspace", mcp: [connection] })

  let settled = false
  const disposing = bridge.dispose().then(() => {
    settled = true
  })
  await sleep(10)
  expect(settled).toBe(false)

  releaseMcp()
  await disposing
  expect(settled).toBe(true)
})

test("dispose() is memoized and resolves immediately on an idle bridge", async () => {
  const store = new MemorySessionStore()
  const bridge = createSessionHandlers({ store, createRunner: () => ({}) as Runner })
  const first = bridge.dispose()
  const second = bridge.dispose()
  expect(second).toBe(first)
  await Promise.race([
    first,
    sleep(200).then(() => {
      throw new Error("idle dispose() did not resolve promptly")
    }),
  ])
})

test("dispose() flushes a close()-detached turn's queued updates", async () => {
  const store = new MemorySessionStore()
  const updates = createUpdateBridge()
  const { runner, bus, entered, releaseAbort } = makeRunner(store, {
    onAbort: (sessionId) =>
      bus.emit("text-delta", { sessionId, messageId: "m1", partId: "p1", delta: "partial", text: "partial" }),
  })
  const bridge = createSessionHandlers({
    store,
    createRunner: () => runner,
    onTurnStart: (turn) => updates.onTurnStart(turn),
    onTurnEnd: (turn) => updates.onTurnEnd(turn),
    log: () => {},
  })
  const notes: any[] = []
  const client = {
    notify: async (_method: string, params: any) => {
      notes.push(params.update)
    },
  }
  const { sessionId } = newSession(bridge)
  const running = bridge.prompt(
    { sessionId, prompt: [{ type: "text", text: "x" }] } as never,
    callCtx(client),
  )
  await entered

  // Detach the turn from the bridge; dispose must still await it (its promise
  // is tracked at bridge scope) and flush its queued notification.
  bridge.close({ sessionId })
  const disposing = bridge.dispose()
  releaseAbort()
  await running
  await disposing

  expect(notes.map((n) => n.content?.text)).toContain("partial")
})

// ---------------------------------------------------------------------------
// Subprocess: real `runAcpStdio` over a pipe (fake-acp-agent fixture).
// ---------------------------------------------------------------------------

const FIXTURE = new URL("./fixtures/fake-acp-agent.ts", import.meta.url).pathname
const STUBBORN = new URL("./fixtures/mcp-stubborn-server.mjs", import.meta.url).pathname
const REPO_ROOT = new URL("../..", import.meta.url).pathname

function spawnAgent() {
  return Bun.spawn({
    cmd: [process.execPath, FIXTURE],
    cwd: REPO_ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
}

/** Line-oriented NDJSON reader over a spawned agent's stdout. */
function readerFor(proc: ReturnType<typeof spawnAgent>) {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return async function next(): Promise<any> {
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) return JSON.parse(line)
        continue
      }
      const { value, done } = await reader.read()
      if (done) throw new Error("agent stdout closed")
      buffer += decoder.decode(value)
    }
  }
}

const request = (id: number, method: string, params: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"

// UNMET CRITERION (documented, not weakened): "a client that closes stdin
// mid-turn receives the queued session/update notifications before the process
// exits". With @agentclientprotocol/sdk 1.5.1 the stdin EOF aborts
// `connectionContext.signal` and fails the session/update router BEFORE
// `connection.closed` resolves, so a notification emitted by the abort is
// rejected with "ACP connection closed" no matter how we await teardown. Keep
// this as `test.failing` so the gap is exercised and visible; promoting it
// requires an SDK seam (or an EOF hook that flushes before the router fails).
// The achievable half of the guarantee — teardown is awaited, queued updates
// are flushed before a normal/cancelled response, and MCP children are reaped —
// is covered by the tests above and by test/acp/cancellation.test.ts.
test.failing("EOF mid-turn flushes the queued update before the process exits", async () => {
  const proc = spawnAgent()
  try {
    const next = readerFor(proc)
    proc.stdin.write(request(1, "initialize", { protocolVersion: acpSdk.PROTOCOL_VERSION }))
    await next()
    proc.stdin.write(request(2, "session/new", { cwd: "/workspace", mcpServers: [] }))
    const created = await next()
    const sessionId: string = created.result.sessionId

    proc.stdin.write(request(3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "BLOCK" }] }))
    // The echo update proves the turn is in flight.
    for (;;) {
      const message = await next()
      if (message.method === "session/update" && message.params.update.sessionUpdate === "agent_message_chunk") break
    }

    proc.stdin.end()

    // Drain everything the agent writes before it exits.
    const rest: any[] = []
    try {
      for (;;) rest.push(await next())
    } catch {
      // stdout closed: teardown finished.
    }

    const partial = rest.find(
      (m) => m.method === "session/update" && m.params.update.content?.text === "partial",
    )
    expect(partial).toBeDefined()
    expect(await proc.exited).toBe(0)
  } finally {
    if (proc.exitCode === null) proc.stdin.end()
    await proc.exited
  }
}, 20_000)

test("a SIGTERM-ignoring MCP server is SIGKILLed; the ACP process exits after it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quark-stubborn-"))
  const marker = join(dir, "marker.txt")
  const proc = spawnAgent()
  try {
    const next = readerFor(proc)
    proc.stdin.write(request(1, "initialize", { protocolVersion: acpSdk.PROTOCOL_VERSION }))
    await next()
    proc.stdin.write(
      request(2, "session/new", {
        cwd: "/workspace",
        mcpServers: [
          {
            name: "stubborn",
            command: process.execPath,
            args: [STUBBORN],
            env: [{ name: "STUBBORN_MARKER", value: marker }],
          },
        ],
      }),
    )
    const created = await next()
    expect(created.result.sessionId).toBeString()

    const started = Date.now()
    proc.stdin.end()
    const exitCode = await proc.exited
    const elapsed = Date.now() - started

    expect(exitCode).toBe(0)
    // The grace period elapsed: SIGTERM was ignored, so SIGKILL was required.
    expect(elapsed).toBeGreaterThanOrEqual(1500)

    const content = await readFile(marker, "utf8")
    expect(content).toContain("SIGTERM")
    const pid = Number(/pid=(\d+)/.exec(content)?.[1])
    expect(pid).toBeGreaterThan(0)
    // The child is gone (reaped after SIGKILL): no leftover MCP process.
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    if (proc.exitCode === null) proc.stdin.end()
    await proc.exited
    await rm(dir, { recursive: true, force: true })
  }
}, 20_000)
