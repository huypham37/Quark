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
//     is advertised in lockstep (never one without the other); the host's gate
//     follows the session's profile/model so a switch cannot leave it stale.

import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import { defaultSessionStore, type Runner, type SessionStore, type ToolDef } from "@quark/runner"
import { registerInitialization } from "./initialization"
import {
  registerSessions,
  type SessionBridge,
  type SessionBridgeOptions,
  type SessionSelection,
} from "./sessions"
import { registerLifecycle, type SessionLifecycle } from "./lifecycle"
import { registerCancellation } from "./cancellation"
import { createUpdateBridge } from "./updates"
import { createPermissionBridge } from "./permissions"
import { createToolCallIds } from "./tool-call-ids"
import {
  buildConfigOptions,
  registerConfigOptions,
  type ConfigOptionDefaults,
  type ModelOption,
  type ProfileOption,
} from "./config-options"

export { AGENT_NAME, AGENT_VERSION } from "./initialization"
export { createUpdateBridge } from "./updates"
export type { UpdateBridge, UpdateBridgeOptions } from "./updates"
export type { SessionBridge, SessionBridgeOptions, SessionSelection, SessionTurn } from "./sessions"
export type { SessionLifecycle, LifecycleOptions } from "./lifecycle"
export { createPermissionBridge } from "./permissions"
export type { PermissionBridge, PermissionBridgeOptions } from "./permissions"
export { connectMcpServer, connectStdioServers, requireStdio } from "./mcp"
export type { McpConnection, McpConnectOptions } from "./mcp"
export { createToolCallIds } from "./tool-call-ids"
export type { ToolCallIds, ToolCallIdScope } from "./tool-call-ids"
export { buildConfigOptions, registerConfigOptions, effectiveModel } from "./config-options"
export type { ModelOption, ProfileOption, ConfigOptionsContext } from "./config-options"

export interface AcpAgentOptions {
  /**
   * Shared persistence for this connection: every session runner is created
   * with it, and `session/list|resume|load|delete` read/write it. Defaults to
   * the process-global JSONL store, so ACP sessions survive a restart and are
   * the same ones the CLI/TUI list. A `session/new` id becomes the persisted
   * session id on the first prompt, so the client's thread id is resumable.
   * Pass an in-memory store in tests.
   */
  store?: SessionStore
  /**
   * Create the runner for one ACP session. Called lazily on that session's first
   * prompt — and again after the client switches its profile — so `session/new`
   * stays cheap. The host owns agent/config resolution; `cwd` is the session's
   * requested workspace, `store` is the connection's shared persistence — pass it
   * through to `createRunner` so a resumed session reads the same history the
   * lifecycle lists — `mcpTools` are the tools discovered from the session's
   * stdio MCP servers, which the host merges into the agent's tool set (empty
   * when the session declared none), and `profile` is the session's selected
   * profile id (null for the connection default). Must be synchronous: the bridge
   * captures the runner before the turn awaits, so `cancel` can reach a first
   * turn.
   */
  createRunner(cwd: string, store: SessionStore, mcpTools: ToolDef[], profile: string | null): Runner
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
   * Whether the model a session will run accepts image input, when the host
   * knows (option B): `images: true` advertises the capability, and returning
   * `false` here rejects image-bearing prompts with a clear error instead of
   * silently degrading or failing mid-turn. Called with the session's profile
   * and model selections, so a host that lets the client switch either keeps the
   * gate on the model that will actually answer. `undefined` (model unknown)
   * passes images through and lets the provider surface its own error.
   */
  imageSupport?(selection: SessionSelection): boolean | undefined
  /**
   * Available models for the ACP `configOptions` model-picker. When provided,
   * `session/new` responses include a `configOptions` array with
   * `category: "model"` so the client (Zed) can render a model selector.
   * `session/set_config_option` updates the per-session model override.
   * Omit or pass `[]` to suppress the model config option.
   */
  models?: ModelOption[]
  /**
   * Available profiles for the ACP `configOptions` profile selector — the
   * protocol's mode selector, `category: "mode"`. When provided, `session/new`
   * advertises them and `session/set_config_option` switches the session's
   * profile: the bridge drops its runner and the next prompt creates one for the
   * new profile (its agent, tools, system prompt, skills, and model) on the same
   * persisted session. Omit or pass `[]` to suppress the profile selector. A
   * session that is resumed or loaded starts on `defaultProfile` again: the
   * selection is connection/session state, not something ACP persists per thread.
   */
  profiles?: readonly ProfileOption[]
  /**
   * Profile new sessions start on: the one `createRunner` resolves for a null
   * profile. Pass it whenever `profiles` is advertised — it is the selector's
   * initial value, and the host should refuse a value it cannot bind.
   */
  defaultProfile?: string
  /**
   * The agent's default model spec (e.g. `"openai/gpt-5.6-luna"`). Used as
   * the initial `currentValue` in the model config option. Must match one of
   * the `models[].id` values when `models` is provided. Omit when `models`
   * is empty.
   */
  defaultModel?: string
  /**
   * The agent's configured thinking effort, used as the initial effort value
   * when the current model supports it. Omit when the agent has none.
   */
  defaultEffort?: string
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
  // Session config options: when the host provides profiles and/or models,
  // the session bridge returns `configOptions` in `session/new` so the client
  // renders the profile (ACP's mode selector), model, and effort pickers, and
  // the `session/set_config_option` handler updates the per-session selections:
  // the profile rebinds the session's runner, while the model and effort are
  // threaded into `runner.prompt({ model, thinkingEffort })`.
  const models = options.models ?? []
  const profiles = options.profiles ?? []
  const hasConfigOptions = models.length > 0 || profiles.length > 0
  const defaults: ConfigOptionDefaults = {
    ...(options.defaultProfile ? { profile: options.defaultProfile } : {}),
    model: options.defaultModel ?? "",
    ...(options.defaultEffort ? { effort: options.defaultEffort } : {}),
  }
  // QUA-265: one registry per connection. Live turns map raw provider ids to
  // unique ACP ids; replay mints fresh ones, so a replay id can never collide
  // with a later live id.
  const toolCallIds = createToolCallIds()
  // The session bridge is assigned right after registration; config-option
  // building only runs later (on `session/new`, `session/resume`,
  // `session/load`), so the closure can resolve a session's current
  // model/effort overrides from it.
  let sessionsBridge: SessionBridge | undefined
  // Shared callback: session/new, session/resume, and session/load all return
  // the same `configOptions` so the client can render config UI immediately.
  const buildSessionConfigOptions = hasConfigOptions
    ? (sessionId: string) =>
        buildConfigOptions({
          models,
          profiles,
          defaults,
          overrides: {
            profile: sessionsBridge?.getProfileOverride(sessionId) ?? null,
            model: sessionsBridge?.getModelOverride(sessionId) ?? null,
            effort: sessionsBridge?.getEffortOverride(sessionId) ?? null,
          },
        })
    : undefined
  const sessions = registerSessions(app, {
    store,
    createRunner: (cwd, mcpTools, profile) => options.createRunner(cwd, store, mcpTools, profile),
    images: options.images === true,
    imageSupport: options.imageSupport,
    log: options.log,
    onTurnStart: (turn) => {
      // The SAME per-turn scope feeds the update bridge and the permission
      // bridge, so a permission card attaches to the tool card already created.
      const scope = toolCallIds.startTurn()
      if (options.onTurnStart) options.onTurnStart(turn)
      else updates.onTurnStart(turn, scope)
      permissions.onTurnStart(turn, scope)
    },
    // QUA-267: flush the update bridge's queued notifications before the
    // session/prompt response is written. A no-op when a caller-supplied
    // onTurnStart replaced the default bridge (no turn was registered).
    onTurnEnd: (turn) => updates.onTurnEnd(turn),
    buildConfigOptions: buildSessionConfigOptions,
  })
  sessionsBridge = sessions
  // Register session/set_config_option when anything is advertised.
  if (hasConfigOptions) {
    registerConfigOptions(app, { models, profiles, defaults, sessions })
  }
  // QUA-247: lifecycle over the SAME store the runners use. QUA-265: replay
  // shares the connection's tool-call-id registry so replayed ids are unique.
  // Thread the same `buildConfigOptions` so `session/resume` and `session/load`
  // return config options too, matching `session/new`.
  const lifecycle = registerLifecycle(app, sessions, {
    store,
    log: options.log,
    toolCallIds,
    buildConfigOptions: buildSessionConfigOptions,
  })
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
    // Await teardown: every in-flight turn runs its onTurnEnd (flushing queued
    // notifications) and every MCP child is reaped before we resolve.
    await sessions.dispose()
    log("connection closed")
  }
}
