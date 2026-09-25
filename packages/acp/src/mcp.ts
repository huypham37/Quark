// Minimal MCP stdio client for ACP `session/new` (QUA-245).
//
// ACP v1 requires an agent to accept stdio MCP servers: on `session/new` (and
// on resume/load) the client hands over the servers it wants connected, and the
// agent must make their tools available to the model. The manifold engine has
// no MCP client of its own, so this module implements the slice ACP needs:
//
//   spawn -> initialize -> notifications/initialized -> tools/list -> tools/call
//
// Only the stdio transport is implemented. HTTP/SSE/ACP transports are
// explicitly refused by {@link requireStdio} (never silently ignored), matching
// the capabilities we do NOT advertise in the initialize response.
//
// Everything is fail-closed: a server that fails to spawn, fails to hand-shake,
// or times out rejects the whole `session/new` rather than producing a session
// whose declared tools are missing. Discovered tools are wrapped as engine
// `ToolDef`s and namespaced `mcp__<server>__<tool>` so a server tool can never
// shadow a built-in (write/bash/...).
//
// Deliberately NOT implemented (kept out of scope, not half-wired):
//   * MCP resources/prompts/sampling/elicitation — only `tools/*` is used.
//   * `notifications/cancelled` on abort — the in-flight call is rejected
//     locally; the server may keep working on the abandoned call until the
//     next request. ponytail: add the notification if a server misbehaves.
//   * HTTP/SSE transport + reconnection — a dropped server stays dropped; the
//     session must be recreated.
//
// Diagnostics go through `options.log` (the host routes it to stderr). This
// module never writes to stdout: that channel is the ACP NDJSON protocol.

import { spawn, type ChildProcess } from "node:child_process"
import { isAbsolute } from "node:path"
import { z } from "zod"
import { RequestError } from "@agentclientprotocol/sdk"
import type { McpServer, McpServerStdio } from "@agentclientprotocol/sdk"
import type { ToolDef } from "@quark/runner"
import { AGENT_VERSION } from "./initialization"

/** MCP revision we advertise; the server replies with the version it will use. */
const MCP_PROTOCOL_VERSION = "2025-06-18"
const REQUEST_TIMEOUT_MS = 30_000
const KILL_GRACE_MS = 2_000
/** ponytail: cap discovery so a server that always returns a cursor cannot spin. */
const MAX_TOOLS = 1_000

/** Spawn seam so tests can drive the client without a real child process. */
export type McpSpawn = (
  command: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => ChildProcess

/** A live MCP server: its discovered tools and a teardown that kills the child. */
export interface McpConnection {
  name: string
  tools: ToolDef[]
  /** Reject in-flight requests, kill the child (SIGTERM then SIGKILL), await exit. */
  dispose(): Promise<void>
}

export interface McpConnectOptions {
  /** Diagnostics sink (stderr in production). */
  log?(message: string): void
  /** Per-request timeout; defaults to 30s. */
  requestTimeoutMs?: number
  /** @internal Spawn override for tests. */
  spawn?: McpSpawn
}

/**
 * Narrow an ACP MCP server entry to the stdio transport, rejecting everything
 * else with `invalidParams` (a refused session, never a silently ignored server).
 */
export function requireStdio(server: McpServer): McpServerStdio {
  if ("command" in server && typeof (server as McpServerStdio).command === "string") {
    const stdio = server as McpServerStdio
    // ACP requires an absolute path; a relative command would resolve against
    // the server process cwd, which is not the session's workspace.
    if (!isAbsolute(stdio.command)) {
      throw RequestError.invalidParams(
        { name: stdio.name, command: stdio.command },
        `MCP server "${stdio.name}" command must be an absolute path`,
      )
    }
    return stdio
  }
  throw RequestError.invalidParams(
    { name: (server as { name?: string }).name, type: (server as { type?: string }).type ?? "unknown" },
    "unsupported MCP server transport; only stdio (command) MCP servers are supported",
  )
}

/** Connect stdio servers in order; on any failure dispose the ones already up. */
export async function connectStdioServers(
  servers: readonly McpServerStdio[],
  options: McpConnectOptions = {},
): Promise<{ connections: McpConnection[]; tools: ToolDef[] }> {
  const connections: McpConnection[] = []
  try {
    for (const server of servers) connections.push(await connectMcpServer(server, options))
  } catch (error) {
    await Promise.all(connections.map((connection) => connection.dispose()))
    throw error
  }
  return { connections, tools: connections.flatMap((connection) => connection.tools) }
}

/** Connect one stdio MCP server and discover its tools. Rejects on any failure. */
export async function connectMcpServer(
  server: McpServerStdio,
  options: McpConnectOptions = {},
): Promise<McpConnection> {
  const log = options.log ?? (() => {})
  const spawnFn = options.spawn ?? (spawn as unknown as McpSpawn)
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const name = server.name

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const variable of server.env ?? []) env[variable.name] = variable.value

  const child = spawnFn(server.command, server.args ?? [], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })

  let closed = false
  let buffer = ""
  let nextId = 1
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: unknown }>()

  function failAll(error: Error): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer as ReturnType<typeof setTimeout>)
      entry.reject(error)
    }
    pending.clear()
  }

  function handleLine(line: string): void {
    let message: {
      id?: number | string
      result?: unknown
      error?: { message?: string }
      method?: string
    }
    try {
      message = JSON.parse(line)
    } catch {
      log(`MCP ${name}: ignoring malformed message`)
      return
    }
    // Responses carry an id plus result/error; server notifications carry a method.
    if (message.id == null || (message.result === undefined && message.error === undefined)) return
    const entry = typeof message.id === "number" ? pending.get(message.id) : undefined
    if (!entry) return
    pending.delete(message.id as number)
    clearTimeout(entry.timer as ReturnType<typeof setTimeout>)
    if (message.error) entry.reject(new Error(`MCP ${name}: ${message.error.message ?? "request failed"}`))
    else entry.resolve(message.result)
  }

  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) handleLine(line)
    }
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => log(`MCP ${name} stderr: ${chunk.trimEnd()}`))
  // A server that exits without draining stdin makes the next write emit EPIPE;
  // without a listener that becomes an uncaught exception in the agent.
  child.stdin?.on("error", (error) => log(`MCP ${name} stdin: ${error.message}`))
  child.on("error", (error) => {
    if (closed) return
    closed = true
    failAll(error)
  })
  child.on("exit", (code, signal) => {
    if (closed) return
    closed = true
    failAll(new Error(`MCP ${name}: server exited (code=${code}, signal=${signal})`))
  })

  function send(payload: Record<string, unknown>): void {
    child.stdin?.write(`${JSON.stringify(payload)}\n`)
  }

  function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (closed) return Promise.reject(new Error(`MCP ${name}: connection closed`))
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP ${name}: ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      ;(timer as { unref?: () => void }).unref?.()
      pending.set(id, { resolve, reject, timer })
      send({ jsonrpc: "2.0", id, method, params })
    })
  }

  function notify(method: string, params: Record<string, unknown>): void {
    if (!closed) send({ jsonrpc: "2.0", method, params })
  }

  let disposal: Promise<void> | null = null
  function dispose(): Promise<void> {
    if (disposal) return disposal
    closed = true
    failAll(new Error(`MCP ${name}: disposed`))
    disposal = new Promise<void>((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        if (killTimer) clearTimeout(killTimer)
        resolve()
      }
      if (child.exitCode !== null || child.signalCode !== null) return settle()
      child.once("exit", settle)
      try {
        child.kill()
      } catch {
        // Already gone.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {
          // Already gone.
        }
      }, KILL_GRACE_MS)
      ;(killTimer as { unref?: () => void }).unref?.()
    })
    return disposal
  }

  async function callTool(
    toolName: string,
    args: Record<string, unknown>,
    abort: AbortSignal,
  ): Promise<unknown> {
    // Race the call against the turn signal so a cancel cannot leave the engine
    // waiting on a server that never answers.
    const call = request("tools/call", { name: toolName, arguments: args })
    if (abort.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError())
      abort.addEventListener("abort", onAbort, { once: true })
      call.then(
        (value) => {
          abort.removeEventListener("abort", onAbort)
          resolve(value)
        },
        (error) => {
          abort.removeEventListener("abort", onAbort)
          reject(error)
        },
      )
    })
  }

  function toToolDef(tool: unknown): ToolDef | null {
    const candidate = tool as { name?: unknown; description?: unknown; inputSchema?: unknown }
    if (typeof candidate?.name !== "string" || !candidate.name) {
      log(`MCP ${name}: skipping a tool without a name`)
      return null
    }
    const toolName = candidate.name
    let parameters: z.ZodType
    try {
      parameters = candidate.inputSchema
        ? z.fromJSONSchema(candidate.inputSchema as never)
        : z.record(z.string(), z.unknown())
    } catch {
      // A schema we cannot model would make the model call the tool blind.
      log(`MCP ${name}: tool "${toolName}" has an unsupported input schema; skipping`)
      return null
    }
    return {
      id: namespacedToolId(name, toolName),
      description:
        typeof candidate.description === "string" && candidate.description
          ? candidate.description
          : `${toolName} (MCP server ${name})`,
      parameters,
      async execute(args, ctx) {
        const result = (await callTool(toolName, args as Record<string, unknown>, ctx.abort)) as {
          content?: Array<{ type?: string; text?: string }>
          isError?: boolean
        } | null
        const text = Array.isArray(result?.content)
          ? result.content
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n")
          : ""
        const output = text || (result?.content ? JSON.stringify(result.content) : "")
        if (result?.isError) {
          return { title: `${toolName} failed`, output: output || "MCP tool returned an error", metadata: { server: name, isError: true } }
        }
        return { title: toolName, output, metadata: { server: name } }
      },
    }
  }

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "quark", version: AGENT_VERSION },
    })
    notify("notifications/initialized", {})

    const discovered: unknown[] = []
    let cursor: string | undefined
    do {
      const page = (await request("tools/list", cursor ? { cursor } : {})) as {
        tools?: unknown[]
        nextCursor?: string
      }
      for (const tool of page?.tools ?? []) discovered.push(tool)
      cursor = typeof page?.nextCursor === "string" ? page.nextCursor : undefined
    } while (cursor && discovered.length < MAX_TOOLS)

    const tools = discovered
      .map(toToolDef)
      .filter((tool): tool is ToolDef => tool !== null)
    log(`MCP ${name}: connected, ${tools.length} tool(s)`)
    return { name, tools, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}

/** `mcp__<server>__<tool>`, sanitized to the provider tool-name charset. */
function namespacedToolId(server: string, tool: string): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24)
  return `mcp__${safe(server)}__${safe(tool)}`.slice(0, 64)
}

function abortError(): Error {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
}
