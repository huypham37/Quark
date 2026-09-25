// @quark/acp — Wave 2 composition root (QUA-242).
//
// This file owns ONLY composition + process streams. Protocol behavior lives in
// the sibling modules owned by other agents:
//
//   ./initialization (QUA-246)  registerInitialization(app, caps) -> app
//   ./sessions       (QUA-248)  registerSessions(app, opts) -> SessionBridge
//   ./lifecycle      (QUA-247)  registerLifecycle(app, sessions, opts) -> caps
//   ./bridge         (QUA-244)  plugs into SessionBridgeOptions.onTurnStart
//   ./cancellation   (QUA-250)  registers the session/cancel notification
//   ./permissions    (QUA-245)  plugs into SessionBridgeOptions.onTurnStart
//   ./mcp            (QUA-245)  stdio MCP connect/discover/invoke/cleanup
//
// The host (`quark acp`) resolves config/profile and hands us a `createRunner`
// factory; this package never reads Quark config and never touches the TUI.
//
// QUA-245 wires three release gates here:
//   * stdio MCP: `session/new` (and resume/load) connect the client's servers;
//     the discovered tools are merged into the runner by the host via the third
//     `createRunner` argument (`createRunner(cwd, store, mcpTools)`).
//   * permissions: the permission bridge gates every non-read-only tool BEFORE
//     it executes, via the engine's pre-execution hook; denials throw.
//   * images: `RunnerPromptInput.images` is wired and `promptCapabilities.image`
//     is advertised in lockstep (never one without the other).

import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import { defaultSessionStore, type Runner, type SessionStore, type ToolDef } from "@quark/runner"
import { registerInitialization } from "./initialization"
import { registerSessions, type SessionBridge, type SessionBridgeOptions } from "./sessions"
import { registerLifecycle, type SessionLifecycle } from "./lifecycle"
import { registerCancellation } from "./cancellation"
import { createUpdateBridge } from "./updates"
import { createPermissionBridge } from "./permissions"

export { AGENT_NAME, AGENT_VERSION } from "./initialization"
export { createUpdateBridge } from "./updates"
export type { UpdateBridge, UpdateBridgeOptions } from "./updates"
export type { SessionBridge, SessionBridgeOptions, SessionTurn } from "./sessions"
export type { SessionLifecycle, LifecycleOptions } from "./lifecycle"
export { createPermissionBridge } from "./permissions"
export type { PermissionBridge, PermissionBridgeOptions } from "./permissions"
export { connectMcpServer, connectStdioServers, requireStdio } from "./mcp"
export type { McpConnection, McpConnectOptions } from "./mcp"

export interface AcpAgentOptions {
  /**
   * Shared persistence for this connection: every session runner is created
   * with it, and `session/list|resume|load|delete` read/write it. Defaults to
   * the process-global JSONL store, so ACP sessions survive a restart and are
   * the same ones the CLI/TUI list. Pass an in-memory store in tests.
   */
  store?: SessionStore
  /**
   * Create the runner for one ACP session. Called lazily on that session's
   * first prompt, so `session/new` stays cheap. The host owns agent/config
   * resolution; `cwd` is the session's requested workspace, `store` is the
   * connection's shared persistence — pass it through to `createRunner` so a
   * resumed session reads the same history the lifecycle lists — and `mcpTools`
   * are the tools discovered from the session's stdio MCP servers, which the
   * host merges into the agent's tool set (empty when the session declared none).
   */
  createRunner(cwd: string, store: SessionStore, mcpTools: ToolDef[]): Runner
  /** QUA-244 seam: bridge runner bus events to `session/update` notifications. */
  onTurnStart?: SessionBridgeOptions["onTurnStart"]
  /**
   * Advertise and map ACP `image` prompt blocks (QUA-245). Off by default so the
   * bridge keeps its mandatory baseline (text + resource_link); the `quark acp`
   * host turns it on. Capability advertisement and the block mapping are
   * toggled together — never one without the other.
   */
  images?: boolean
  /**
   * Whether the session's model accepts image input, when the host knows
   * (option B): `images: true` advertises the capability, `imageSupport: false`
   * rejects image-bearing prompts with a clear error instead of silently
   * degrading or failing mid-turn. `undefined` (model unknown) passes images
   * through and lets the provider surface its own error.
   */
  imageSupport?: boolean
  /** Diagnostics sink. Defaults to stderr — stdout is reserved for NDJSON. */
  log?: (message: string) => void
}

/** A configured, connection-scoped ACP agent plus its session bridge. */
export interface AcpAgent {
  app: acp.AgentApp
  sessions: SessionBridge
  /** Persistent lifecycle handlers + the capabilities they advertise. */
  lifecycle: SessionLifecycle
}

/**
 * Build the ACP agent app. Composition only: the protocol behavior lives in
 * the sibling modules (`./initialization`, `./sessions`, `./lifecycle`,
 * `./cancellation`).
 */
export function createAcpAgent(options: AcpAgentOptions): AcpAgent {
  const store = options.store ?? defaultSessionStore
  const app = acp.agent({ name: "quark" })
  // Register `initialize` first: the SDK walks registered handlers in order for
  // every message, so a late registration delays the initialize response behind
  // any pipelined request. The capabilities object is filled in once the
  // lifecycle handlers exist, keeping the advertised set exactly the installed
  // handlers without a second source of truth.
  const capabilities: acp.AgentCapabilities = {}
  registerInitialization(app, capabilities)
  // QUA-245: advertise image support only when the host opted in, and in the
  // same breath enable the mapping below — the two must never drift.
  if (options.images) capabilities.promptCapabilities = { image: true }
  // QUA-244: bridge runner bus events to session/update notifications by
  // default. A caller-supplied onTurnStart replaces it (unchanged contract);
  // the QUA-245 permission gate is always installed.
  const updates = createUpdateBridge({ log: options.log })
  // QUA-245: gate every non-read-only tool before it executes. Denied tools
  // throw out of the engine's pre-execution hook, so they never run.
  const permissions = createPermissionBridge({ log: options.log })
  const sessions = registerSessions(app, {
    createRunner: (cwd, mcpTools) => options.createRunner(cwd, store, mcpTools),
    images: options.images === true,
    imageSupport: options.imageSupport,
    log: options.log,
    onTurnStart: (turn) => {
      if (options.onTurnStart) options.onTurnStart(turn)
      else updates.onTurnStart(turn)
      permissions.onTurnStart(turn)
    },
  })
  // QUA-247: lifecycle over the SAME store the runners use.
  const lifecycle = registerLifecycle(app, sessions, { store, log: options.log })
  Object.assign(capabilities, lifecycle.capabilities)
  registerCancellation(app, sessions)
  return { app, sessions, lifecycle }
}

/** NDJSON stream over process stdio: stdin in, stdout out. */
export function createStdioStream(): acp.Stream {
  return acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  )
}

/**
 * Serve one ACP connection over stdio until the client closes stdin (EOF), then
 * cancel any active runners. Diagnostics go to stderr; stdout stays protocol-only.
 */
export async function runAcpStdio(options: AcpAgentOptions): Promise<void> {
  const log = options.log ?? ((message: string) => process.stderr.write(`[quark acp] ${message}\n`))
  const { app, sessions } = createAcpAgent(options)
  const connection = app.connect(createStdioStream())
  log("connected on stdio")
  try {
    await connection.closed
  } finally {
    // EOF/transport close must cancel active runners, not orphan their turns.
    sessions.dispose()
    log("connection closed")
  }
}
