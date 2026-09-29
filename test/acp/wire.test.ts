// QUA-243 wire tests: the ACP agent over a REAL subprocess stdio pipe.
//
// Every test spawns `test/acp/fixtures/fake-acp-agent.ts`, which runs the
// production `runAcpStdio` transport with a scripted fake runner injected (no
// model, no network). High-level tests drive it with the official
// `@agentclientprotocol/sdk` client; low-level tests write raw NDJSON bytes so
// framing, parse errors, unknown methods and stdout purity are observed on the
// wire itself rather than through the SDK.
//
// Keep this file in `test/acp` (package root): the package-local
// `packages/acp/test/sessions.test.ts` globally mocks `@agentclientprotocol/sdk`,
// so wire tests must live where the real SDK is loaded.

import { expect, test } from "bun:test"
import type * as acp from "@agentclientprotocol/sdk"
import * as acpSdk from "@agentclientprotocol/sdk"

const FIXTURE = new URL("./fixtures/fake-acp-agent.ts", import.meta.url).pathname
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

/** Official SDK stream over a real subprocess: our Web writable -> child stdin. */
function streamFor(proc: ReturnType<typeof spawnAgent>) {
  return acpSdk.ndJsonStream(
    new WritableStream<Uint8Array>({
      write(chunk) {
        proc.stdin.write(chunk)
      },
    }),
    proc.stdout as ReadableStream<Uint8Array>,
  )
}

/**
 * Same as {@link streamFor} but writes one byte at a time with a yield between
 * writes, so line and multibyte UTF-8 sequences are guaranteed to straddle
 * child-stdin reads. Used to prove the SDK's line buffer reassembles them.
 */
function byteDripStreamFor(proc: ReturnType<typeof spawnAgent>) {
  return acpSdk.ndJsonStream(
    new WritableStream<Uint8Array>({
      async write(chunk) {
        for (let i = 0; i < chunk.length; i++) {
          proc.stdin.write(chunk.subarray(i, i + 1))
          await Bun.sleep(1)
        }
      },
    }),
    proc.stdout as ReadableStream<Uint8Array>,
  )
}

async function collect(proc: ReturnType<typeof spawnAgent>) {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

/** ACP-visible text of a chunk-style update, or undefined for other updates. */
function chunkText(update: acp.SessionUpdate): string | undefined {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "user_message_chunk":
      return update.content.type === "text" ? update.content.text : undefined
    default:
      return undefined
  }
}

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

const asServer = (server: unknown) => server as acp.McpServer

test("streams text and a full tool lifecycle over the official client", async () => {
  const proc = spawnAgent()
  const conn = acpSdk.client({ name: "stream" }).connect(streamFor(proc))

  try {
    const init = await conn.agent.request(acpSdk.methods.agent.initialize, {
      protocolVersion: acpSdk.PROTOCOL_VERSION,
    })
    expect(init.agentInfo).toEqual({ name: "quark", version: expect.any(String) })
    expect(init.agentCapabilities?.loadSession).toBe(true)

    const session = await conn.agent.buildSession("/workspace").start()
    const done = session.prompt("TOOL hello")

    const updates: acp.SessionUpdate[] = []
    let stopReason: acp.StopReason | undefined
    for (;;) {
      const message = await session.nextUpdate()
      if (message.kind === "stop") {
        stopReason = message.stopReason
        break
      }
      // Every notification is scoped to this ACP session, not the runner id.
      expect(message.notification.sessionId).toBe(session.sessionId)
      updates.push(message.update)
    }

    expect(stopReason).toBe("end_turn")
    expect(await done).toEqual({ stopReason: "end_turn" })
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      "agent_message_chunk",
      "tool_call",
      "tool_call_update",
      "tool_call_update",
      "tool_call_update",
    ])
    expect(chunkText(updates[0]!)).toMatch(/^echo\[[^\]]+\]:TOOL hello$/)
    expect(updates[1]).toMatchObject({
      sessionUpdate: "tool_call",
      name: "read",
      kind: "read",
      status: "pending",
      title: "Read",
    })
    // QUA-265: ACP ids are remapped at the boundary, never the raw provider id,
    // and one call keeps a single id across its whole lifecycle.
    const toolCallId = toolCallIdOf(updates[1]!)
    expect(toolCallId).toBeTruthy()
    expect(toolCallId).not.toBe("call-1")
    expect(updates[2]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId,
      title: "Read /tmp/a.ts",
      rawInput: { filePath: "/tmp/a.ts" },
    })
    expect(updates[3]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "in_progress",
    })
    expect(updates[4]).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      rawOutput: "contents",
    })

    // Audio is never advertised and stays refused at the trust boundary.
    await expect(
      session.prompt([{ type: "audio", mimeType: "audio/wav", data: "AAAA" }]),
    ).rejects.toMatchObject({ code: -32602 })
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 20_000)

test("concurrent sessions stay isolated; cancel targets one turn only", async () => {
  const proc = spawnAgent()
  const conn = acpSdk.client({ name: "multi" }).connect(streamFor(proc))

  try {
    const a = await conn.agent.buildSession("/workspace").start()
    const b = await conn.agent.buildSession("/workspace").start()
    expect(a.sessionId).not.toBe(b.sessionId)

    // A blocks mid-turn; reading its first update proves its runner exists.
    const aDone = a.prompt("BLOCK")
    const aFirst = await a.nextUpdate()
    if (aFirst.kind !== "session_update") throw new Error("expected an update")
    const runnerA = /^echo\[([^\]]+)\]:BLOCK$/.exec(chunkText(aFirst.update) ?? "")?.[1]
    expect(runnerA).toBeDefined()

    // B runs to completion while A is still blocked.
    const bDone = b.prompt("B")
    const bUpdates: acp.SessionUpdate[] = []
    for (;;) {
      const message = await b.nextUpdate()
      if (message.kind === "stop") break
      bUpdates.push(message.update)
    }
    expect(await bDone).toEqual({ stopReason: "end_turn" })
    const runnerB = /^echo\[([^\]]+)\]:B$/.exec(chunkText(bUpdates[0]!) ?? "")?.[1]
    expect(runnerB).toBeDefined()
    expect(runnerA).not.toBe(runnerB)

    // Cancel A only; B's completed turn is untouched.
    await conn.agent.notify(acpSdk.methods.agent.session.cancel, { sessionId: a.sessionId })
    const aUpdates: acp.SessionUpdate[] = []
    for (;;) {
      const message = await a.nextUpdate()
      if (message.kind === "stop") break
      aUpdates.push(message.update)
    }
    expect(await aDone).toEqual({ stopReason: "cancelled" })

    const aText = aUpdates.map(chunkText).filter((text): text is string => text != null)
    expect(aText).toContain("partial")
    expect(aText.join("\n")).not.toContain("]:B")
    expect(chunkText(bUpdates[0]!)).not.toContain("BLOCK")
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 20_000)

test("resume over the wire adopts a listed session for the next prompt", async () => {
  const proc = spawnAgent()
  const seen: acp.SessionNotification[] = []
  const app = acpSdk
    .client({ name: "resume" })
    .onNotification(acpSdk.methods.client.session.update, ({ params }) => {
      seen.push(params)
    })
  const conn = app.connect(streamFor(proc))

  try {
    await conn.agent.request(acpSdk.methods.agent.initialize, {
      protocolVersion: acpSdk.PROTOCOL_VERSION,
    })
    const listed = await conn.agent.request(acpSdk.methods.agent.session.list, {})
    expect(listed.sessions.map((s) => s.sessionId)).toContain("seeded-1")

    expect(
      await conn.agent.request(acpSdk.methods.agent.session.resume, {
        sessionId: "seeded-1",
        cwd: "/workspace",
      }),
    ).toEqual({})

    const response = await conn.agent.request(acpSdk.methods.agent.session.prompt, {
      sessionId: "seeded-1",
      prompt: [{ type: "text", text: "again" }],
    })
    expect(response).toEqual({ stopReason: "end_turn" })

    // The runner was handed the persisted id, so it echoed the same one.
    const update = seen.find(
      (n) => n.sessionId === "seeded-1" && n.update.sessionUpdate === "agent_message_chunk",
    )
    expect(chunkText(update!.update)).toBe("echo[seeded-1]:again")
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 20_000)

test("refuses schema-valid MCP transports it cannot support", async () => {
  const proc = spawnAgent()
  const conn = acpSdk.client({ name: "mcp" }).connect(streamFor(proc))

  try {
    // HTTP transport is not advertised, so it must be refused, not ignored.
    await expect(
      conn.agent.request(acpSdk.methods.agent.session.new, {
        cwd: "/workspace",
        mcpServers: [asServer({ type: "http", name: "h", url: "http://example.test", headers: [] })],
      }),
    ).rejects.toMatchObject({ code: -32602 })

    // A stdio server that cannot complete the hand-shake fails the session.
    await expect(
      conn.agent.request(acpSdk.methods.agent.session.new, {
        cwd: "/workspace",
        mcpServers: [asServer({ name: "e", command: "/bin/echo", args: [], env: [] })],
      }),
    ).rejects.toMatchObject({ code: -32602 })
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 20_000)

// KNOWN DEFECT (QUA-245): a schema-invalid `mcpServers` entry is silently
// coerced to `[]` by the SDK's `x-deserialize-default-on-error` before the
// agent handler runs, so the session is created with the requested server
// dropped — exactly what the module comment says never happens. `test.failing`
// documents the gap and will flip to a normal failing test (prompting
// promotion) once the entry is rejected or connected.
test.failing("does not silently ignore a schema-invalid mcpServers entry", async () => {
  const proc = spawnAgent()
  const conn = acpSdk.client({ name: "mcp-drop" }).connect(streamFor(proc))

  try {
    // Missing McpServerStdio's required `args`/`env`.
    await expect(
      conn.agent.request(acpSdk.methods.agent.session.new, {
        cwd: "/workspace",
        mcpServers: [asServer({ name: "m", command: "/bin/echo" })],
      }),
    ).rejects.toBeDefined()
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 20_000)

test("raw wire: parse error, unknown method and invalid params keep serving", async () => {
  const proc = spawnAgent()
  const lines = [
    `{ this is not json`,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "does/not/exist", params: {} }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: 999 },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "session/new",
      params: { cwd: "relative", mcpServers: [] },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "session/prompt",
      params: { sessionId: "nope", prompt: [{ type: "text", text: "hi" }] },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 5, method: "session/prompt", params: { sessionId: "nope" } }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "initialize",
      params: { protocolVersion: acpSdk.PROTOCOL_VERSION },
    }),
  ]
  proc.stdin.write(lines.join("\n") + "\n")
  proc.stdin.end()

  const { stdout, exitCode } = await collect(proc)
  expect(exitCode).toBe(0)
  const responses = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const byId = new Map(responses.map((response) => [response.id, response]))

  // The parse error has no request id but must not close the connection.
  expect(responses.find((r) => r.id === null)?.error.code).toBe(-32700)
  expect(byId.get(1)?.error.code).toBe(-32601)
  expect(byId.get(1)?.error.data).toMatchObject({ method: "does/not/exist" })
  expect(byId.get(2)?.error.code).toBe(-32602)
  expect(byId.get(2)?.error.data).toEqual({ requested: 999, supported: acpSdk.PROTOCOL_VERSION })
  expect(byId.get(3)?.error.code).toBe(-32602)
  expect(byId.get(4)?.error.code).toBe(-32602)
  // Missing required `prompt`: the SDK schema rejects it before the handler.
  expect(byId.get(5)?.error.code).toBe(-32602)
  // Still alive: a valid initialize after all of the above succeeds.
  expect(byId.get(6)?.result.protocolVersion).toBe(acpSdk.PROTOCOL_VERSION)
}, 20_000)

test("split multibyte UTF-8 across stdin writes survives to the runner", async () => {
  const proc = spawnAgent()
  // One byte at a time: every write boundary (including inside é/☕/世) is a
  // potential partial read for the agent's NDJSON decoder.
  const conn = acpSdk.client({ name: "utf8" }).connect(byteDripStreamFor(proc))

  try {
    const session = await conn.agent.buildSession("/workspace").start()
    const text = "héllo ☕ 世界"
    const done = session.prompt(text)

    const updates: acp.SessionUpdate[] = []
    for (;;) {
      const message = await session.nextUpdate()
      if (message.kind === "stop") break
      updates.push(message.update)
    }

    expect(await done).toEqual({ stopReason: "end_turn" })
    expect(chunkText(updates[0]!)).toMatch(/^echo\[[^\]]+\]:héllo ☕ 世界$/)
  } finally {
    proc.stdin.end()
    await proc.exited
  }
}, 30_000)

test("stdout stays pure JSON-RPC and EOF exits cleanly", async () => {
  const proc = spawnAgent()
  proc.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: acpSdk.PROTOCOL_VERSION },
    }) + "\n",
  )
  proc.stdin.end()

  const { stdout, stderr, exitCode } = await collect(proc)
  expect(exitCode).toBe(0)

  const lines = stdout.split("\n").filter(Boolean)
  expect(lines.length).toBe(1)
  for (const line of lines) {
    // Throws if any non-protocol text leaked onto stdout.
    const message = JSON.parse(line)
    expect(message.jsonrpc).toBe("2.0")
    expect(message.id).toBe(1)
  }
  expect(stdout).not.toContain("[quark acp]")
  expect(stderr).toContain("[quark acp] connected on stdio")
  expect(stderr).toContain("[quark acp] connection closed")
}, 20_000)

test("EOF during an active turn disposes the runner and exits 0 (no hang)", async () => {
  const proc = spawnAgent()
  const conn = acpSdk.client({ name: "eof" }).connect(streamFor(proc))

  try {
    const session = await conn.agent.buildSession("/workspace").start()
    // Swallow the client-side rejection that follows connection teardown.
    const pending = session.prompt("BLOCK").catch(() => undefined)
    // Wait until the blocking turn has actually started.
    const first = await session.nextUpdate()
    expect(first.kind).toBe("session_update")

    proc.stdin.end()
    const exitCode = await Promise.race([
      proc.exited,
      Bun.sleep(5000).then(() => {
        proc.kill()
        return -1
      }),
    ])
    expect(exitCode).toBe(0)
    await pending
  } finally {
    if (proc.exitCode === null) proc.stdin.end()
    await proc.exited
  }
}, 20_000)
