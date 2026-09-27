// ACP session registry + runner bridge (QUA-248).
//
// Maps ACP session IDs to isolated @quark/runner runners:
//
//   session/new   -> allocate an ACP session ID, connect any stdio MCP servers,
//                    record cwd, create no runner yet
//   session/prompt-> lazily create that session's runner (seeded with the MCP
//                    tools discovered above), translate blocks, run one turn,
//                    remember the runner-created session ID
//
// ACP IDs and runner IDs are distinct: ACP owns the former, the runner mints
// its own on the first prompt (see SessionState.runnerSessionId).
//
// MCP (QUA-245): ACP v1 requires stdio MCP servers to be accepted. Nonempty
// `mcpServers` is validated (stdio only, absolute command) and the servers are
// spawned and hand-shaken on `session/new`; a failure refuses the session
// rather than handing back a session whose declared tools are missing. The
// discovered tools are injected into the runner via `createRunner(cwd, tools)`
// and the connections are killed on `close`/`dispose`/`delete`. HTTP/SSE/ACP
// transports are refused.
//
// Images (QUA-245): when the composition root enables `images`, `image` prompt
// blocks map to `RunnerPromptInput.images`; otherwise they are refused as
// unsupported. Audio/embedded-resource blocks stay unsupported either way.
//
// Persistent lifecycle (QUA-247) attaches to ALREADY-PERSISTED runner sessions:
// `adopt` seeds the ACP→runner mapping with a store session ID so the next
// prompt resumes that history (no replay), `close` cancels and forgets an
// attachment, and `isActive` lets `session/delete` refuse to remove history a
// live turn is still writing. The store itself is owned by the composition
// root and passed to every runner; this module never reads it.

import { methods, RequestError } from "@agentclientprotocol/sdk"
import type {
  AgentApp,
  AgentContext,
  ContentBlock,
  ImageContent,
  McpServerStdio,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResourceLink,
  SessionConfigOption,
} from "@agentclientprotocol/sdk"
import { isAbsolute } from "node:path"
import type { Runner, ToolDef } from "@quark/runner"
import { connectStdioServers, requireStdio, type McpConnection } from "./mcp"

/** One ACP session's registry entry. */
interface SessionState {
  acpSessionId: string
  /** Absolute workspace requested by the client; used as targetWorkspace. */
  cwd: string
  /** Created lazily on first prompt — a session/new must stay cheap. */
  runner: Runner | null
  /** Runner-generated ID; null until the first turn creates it. */
  runnerSessionId: string | null
  /** One active turn per session. */
  active: boolean
  /** Set when `cancel()` hit an active turn, so prompt() reports "cancelled". */
  cancelled: boolean
  /** Removes the runner bus listener created with the runner. */
  unsubscribe: (() => void) | null
  /** Live stdio MCP servers for this session; killed on close/dispose. */
  mcp: McpConnection[]
  /** Tools discovered from `mcp`; injected into the lazy runner. */
  mcpTools: ToolDef[]
  /** Per-session model override; null means use the agent's default. */
  modelOverride: string | null
}

/** Context handed to `onTurnStart`, once per turn, before the runner runs. */
export interface SessionTurn {
  acpSessionId: string
  /** Runner session ID; null only if this is the very first turn. */
  runnerSessionId: string | null
  /** The session's isolated runner, for QUA-244 to subscribe to `runner.bus`. */
  runner: Runner
  /** Per-request signal; aborts when the ACP connection closes. */
  signal: AbortSignal
  /** ACP client context, for `notify(methods.client.session.update, ...)`. */
  client: AgentContext
}

export interface SessionBridgeOptions {
  /**
   * Create the runner for a session. Called once per ACP session, lazily on
   * first prompt, so a session/new cannot fail on provider/agent setup.
   * `mcpTools` are the tools discovered from the session's stdio MCP servers
   * (empty when none); the host merges them into the agent's tool set.
   */
  createRunner(cwd: string, mcpTools: ToolDef[]): Runner
  /**
   * QUA-244 seam: called at the start of every turn with the runner and client
   * context, so the integrator can bridge `runner.bus` events to
   * `client.notify(methods.client.session.update, ...)`.
   */
  onTurnStart?(turn: SessionTurn): void
  /**
   * Accept ACP `image` prompt blocks and map them to `RunnerPromptInput.images`.
   * Off by default: the baseline bridge only claims the mandatory `text` and
   * `resource_link` blocks. The composition root turns this on only when it
   * also advertises `promptCapabilities.image`.
   */
  images?: boolean
  /**
   * Whether the session's model accepts image input, when the host knows.
   * `false` + an image-bearing prompt rejects up front with a clear
   * `invalidParams` error (option B: accept the capability, fail the prompt
   * loudly instead of silently degrading). `true`/`undefined` (unknown model)
   * pass images through and let the provider surface its own error.
   */
  imageSupport?: boolean
  /**
   * Build the initial `configOptions` for a new session (e.g. model picker).
   * Called once per `session/new`; the returned array is included in the
   * response so the client can render config UI immediately. Omit or return
   * an empty array to suppress config options.
   */
  buildConfigOptions?(): SessionConfigOption[]
  /** Diagnostics sink for MCP connect/teardown. Defaults to no-op (stderr in prod). */
  log?(message: string): void
}

/** Per-request dependencies passed to `SessionBridge.prompt`. */
export interface SessionCallContext {
  signal: AbortSignal
  client: AgentContext
}

/**
 * Session handlers, callable directly (tests, custom wiring) or installed onto
 * an `AgentApp` with `registerSessions`.
 *
 * `cancel` is intentionally NOT registered here: QUA-250 owns the
 * `session/cancel` notification handler and calls this method.
 */
export interface SessionBridge {
  /**
   * Register a session. Synchronous when it has no MCP servers; returns a
   * promise (spawning/hand-shaking the servers) when it does.
   */
  newSession(params: NewSessionRequest): NewSessionResponse | Promise<NewSessionResponse>
  prompt(params: PromptRequest, ctx: SessionCallContext): Promise<PromptResponse>
  /** QUA-250 seam: abort the active turn of `sessionId` (no-op if idle). */
  cancel(params: { sessionId: string }): void
  /**
   * QUA-247 seam: attach an existing persisted runner session to `acpSessionId`
   * so the next prompt resumes that history. The runner loads the stored
   * messages for the model; nothing is replayed to the client (that is
   * `session/load`'s job). `cwd` is the client-requested workspace; the runner's
   * stored directory remains authoritative on resume. `mcp` are already-connected
   * stdio servers (resume/load), owned by the bridge and killed on close.
   */
  adopt(params: {
    acpSessionId: string
    cwd: string
    runnerSessionId: string
    mcp?: McpConnection[]
  }): void
  /** Cancel any active turn for `sessionId` and forget the attachment. */
  close(params: { sessionId: string }): void
  /** Whether an active turn is running for this ACP or runner session ID. */
  isActive(sessionId: string): boolean
  /** Cancel active turns and forget all sessions (connection teardown). */
  dispose(): void
  /** Runner session ID for an ACP session; for diagnostics and tests. */
  runnerSessionId(acpSessionId: string): string | null
  /** Set the model override for a session (used by `session/set_config_option`). */
  setModelOverride(acpSessionId: string, model: string): void
  /** Get the model override for a session; null means the agent default. */
  getModelOverride(acpSessionId: string): string | null
}

/**
 * Build session handlers without an `AgentApp`.
 *
 * @example
 * ```ts
 * const sessions = createSessionHandlers({ createRunner: (cwd) => createRunner({ agent }) })
 * const { sessionId } = sessions.newSession({ cwd, mcpServers: [] })
 * ```
 */
export function createSessionHandlers(options: SessionBridgeOptions): SessionBridge {
  const sessions = new Map<string, SessionState>()
  const log = options.log ?? (() => {})

  function requireSession(acpSessionId: string): SessionState {
    const state = sessions.get(acpSessionId)
    if (!state) {
      throw RequestError.invalidParams({ sessionId: acpSessionId }, "unknown session")
    }
    return state
  }

  /** Register a new session with its (already connected) MCP servers. */
  function registerSession(cwd: string, mcp: McpConnection[]): NewSessionResponse {
    const acpSessionId = crypto.randomUUID()
    sessions.set(acpSessionId, {
      acpSessionId,
      cwd,
      runner: null,
      runnerSessionId: null,
      active: false,
      cancelled: false,
      unsubscribe: null,
      mcp,
      mcpTools: mcp.flatMap((connection) => connection.tools),
      modelOverride: null,
    })
    const configOptions = options.buildConfigOptions?.()
    return {
      sessionId: acpSessionId,
      ...(configOptions?.length ? { configOptions } : {}),
    }
  }

  /** Kill a state's MCP children without awaiting (teardown is best-effort). */
  function disposeMcp(state: SessionState): void {
    for (const connection of state.mcp) void connection.dispose()
    state.mcp = []
    state.mcpTools = []
  }

  function runnerFor(state: SessionState): Runner {
    if (state.runner) return state.runner
    const runner = options.createRunner(state.cwd, state.mcpTools)
    // The runner mints its own session ID on the first prompt and announces it
    // synchronously on this bus, before the turn awaits. Capturing it here lets
    // cancel() reach a first turn and lets later turns resume the same session.
    const onCreated = ({ sessionId }: { sessionId: string }) => {
      state.runnerSessionId ??= sessionId
    }
    runner.bus.on("session-created", onCreated)
    state.runner = runner
    state.unsubscribe = () => runner.bus.off("session-created", onCreated)
    return runner
  }

  return {
    newSession(params) {
      if (!isAbsolute(params.cwd)) {
        throw RequestError.invalidParams({ cwd: params.cwd }, "cwd must be an absolute path")
      }
      if (params.additionalDirectories?.length) {
        throw RequestError.invalidParams(
          { additionalDirectories: params.additionalDirectories },
          "additionalDirectories are not supported yet",
        )
      }
      // Validate every server synchronously first: a refused request must not
      // leave spawned children behind.
      const stdio: McpServerStdio[] = (params.mcpServers ?? []).map(requireStdio)
      if (stdio.length === 0) return registerSession(params.cwd, [])
      // Fail closed: a server that will not connect refuses the session rather
      // than producing one whose declared tools are silently absent.
      return connectStdioServers(stdio, { log })
        .then(({ connections }) => registerSession(params.cwd, connections))
        .catch((error: unknown) => {
          throw RequestError.invalidParams(
            { mcpServers: stdio.map((server) => server.name) },
            `failed to connect MCP server: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
    },

    async prompt(params, ctx) {
      const state = requireSession(params.sessionId)
      if (state.active) {
        throw RequestError.invalidParams(
          { sessionId: params.sessionId },
          "a turn is already in progress for this session",
        )
      }
      const { parts, images } = toRunnerInput(params.prompt, options.images === true)
      // Option B: the capability is advertised, but a model known to lack
      // vision rejects up front — a clear error beats a silent degradation or
      // a mid-turn provider failure after the user already sent the prompt.
      if (images.length > 0 && options.imageSupport === false) {
        throw RequestError.invalidParams(
          { images: images.length },
          "this session's model does not accept image input; resend the prompt without image blocks",
        )
      }
      state.active = true
      state.cancelled = false
      try {
        const runner = runnerFor(state)
        options.onTurnStart?.({
          acpSessionId: state.acpSessionId,
          runnerSessionId: state.runnerSessionId,
          runner,
          signal: ctx.signal,
          client: ctx.client,
        })
        const result = await runner.prompt({
          ...(state.runnerSessionId ? { sessionId: state.runnerSessionId } : {}),
          parts,
          ...(images.length > 0 ? { images } : {}),
          ...(state.modelOverride ? { model: state.modelOverride } : {}),
          targetWorkspace: state.cwd,
        })
        state.runnerSessionId = result.sessionId
        return { stopReason: state.cancelled ? "cancelled" : "end_turn" }
      } catch (error) {
        // ACP: an aborted operation must not surface as an error response.
        // runner.cancel() aborts the run, so prompt() rejects with an
        // AbortError; report `cancelled` instead (also for teardown cancels,
        // which call runner.cancel without setting `cancelled`).
        if (state.cancelled || isAbortError(error)) return { stopReason: "cancelled" }
        throw error
      } finally {
        state.active = false
        state.cancelled = false
      }
    },

    cancel({ sessionId }) {
      const state = sessions.get(sessionId)
      // Only an active turn is cancellable; a late cancel must not mark the
      // next turn cancelled.
      if (!state?.active) return
      state.cancelled = true
      if (state.runner && state.runnerSessionId) {
        state.runner.cancel(state.runnerSessionId)
      }
      // ponytail: a cancel landing before the runner announces its first
      // session ID cannot abort that turn (no ID to target). The window is
      // synchronous, so it is unreachable once the prompt request is underway.
    },

    adopt({ acpSessionId, cwd, runnerSessionId, mcp = [] }) {
      const existing = sessions.get(acpSessionId)
      if (existing) {
        // Re-adopting the same mapping must not strand newly spawned MCP children.
        if (existing.runnerSessionId === runnerSessionId) {
          for (const connection of mcp) void connection.dispose()
          return
        }
        throw RequestError.invalidParams(
          { sessionId: acpSessionId },
          "session id is already attached to a different session",
        )
      }
      // One persisted session must not back two live attachments: both runners
      // would resume and append to the same history.
      for (const state of sessions.values()) {
        if (state.runnerSessionId === runnerSessionId) {
          throw RequestError.invalidParams({ sessionId: runnerSessionId }, "session is already attached")
        }
      }
      sessions.set(acpSessionId, {
        acpSessionId,
        cwd,
        runner: null,
        runnerSessionId,
        active: false,
        cancelled: false,
        unsubscribe: null,
        mcp,
        mcpTools: mcp.flatMap((connection) => connection.tools),
        modelOverride: null,
      })
    },

    close({ sessionId }) {
      // ACP `session/close`: cancel ongoing work, kill MCP servers, then forget
      // the attachment. Idempotent for unknown/idle IDs. An active turn keeps
      // running against the now-detached state and resolves through its abort.
      for (const [key, state] of sessions) {
        if (state.acpSessionId !== sessionId && state.runnerSessionId !== sessionId) continue
        if (state.active && state.runner && state.runnerSessionId) {
          state.cancelled = true
          state.runner.cancel(state.runnerSessionId)
        }
        state.unsubscribe?.()
        disposeMcp(state)
        sessions.delete(key)
      }
    },

    isActive(sessionId) {
      for (const state of sessions.values()) {
        if (state.active && (state.acpSessionId === sessionId || state.runnerSessionId === sessionId)) {
          return true
        }
      }
      return false
    },

    dispose() {
      for (const state of sessions.values()) {
        if (state.active && state.runner && state.runnerSessionId) {
          state.runner.cancel(state.runnerSessionId)
        }
        state.unsubscribe?.()
        disposeMcp(state)
      }
      sessions.clear()
    },

    runnerSessionId(acpSessionId) {
      return sessions.get(acpSessionId)?.runnerSessionId ?? null
    },

    setModelOverride(acpSessionId, model) {
      const state = requireSession(acpSessionId)
      state.modelOverride = model
    },

    getModelOverride(acpSessionId) {
      return sessions.get(acpSessionId)?.modelOverride ?? null
    },
  }
}

/**
 * Install the session handlers on an ACP `AgentApp` (QUA-242's composition root).
 * Registers `session/new` and `session/prompt` only — `session/cancel` is
 * QUA-250's. Returns the bridge so the host can call `dispose()` on connection
 * close (which must cancel active runners).
 */
export function registerSessions(app: AgentApp, options: SessionBridgeOptions): SessionBridge {
  const bridge = createSessionHandlers(options)
  app.onRequest(methods.agent.session.new, ({ params }) => bridge.newSession(params))
  app.onRequest(methods.agent.session.prompt, ({ params, signal, client }) =>
    bridge.prompt(params, { signal, client }),
  )
  return bridge
}

/** AbortError-shaped failures (DOMException or Error with the name) mean cancelled. */
function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError"
}

/** Runner prompt pieces derived from ACP content blocks. */
interface RunnerInput {
  parts: { type: "text"; text: string }[]
  images: { mime: string; data: string }[]
}

/**
 * Translate ACP prompt blocks to runner parts (+ images when enabled),
 * rejecting unsupported ones so a block is never silently dropped.
 */
function toRunnerInput(blocks: ContentBlock[], imagesEnabled: boolean): RunnerInput {
  if (blocks.length === 0) {
    throw RequestError.invalidParams(undefined, "prompt must contain at least one content block")
  }
  const parts: RunnerInput["parts"] = []
  const images: RunnerInput["images"] = []
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text) parts.push({ type: "text", text: block.text })
        break
      case "resource_link":
        parts.push({ type: "text", text: resourceLinkText(block) })
        break
      case "image":
        if (!imagesEnabled) {
          // Advertised capability and mapping must agree: never accept an image
          // the runner was not wired to forward.
          throw RequestError.invalidParams(
            { type: block.type },
            `unsupported prompt content block "image"; the agent has not advertised promptCapabilities.image`,
          )
        }
        {
          const image = block as ImageContent
          if (!image.data || !image.mimeType) {
            throw RequestError.invalidParams({ type: "image" }, "image block must carry mimeType and base64 data")
          }
          images.push({ mime: image.mimeType, data: image.data })
        }
        break
      default:
        // Baseline blocks are text + resource_link; image is opt-in.
        throw RequestError.invalidParams(
          { type: block.type },
          `unsupported prompt content block "${block.type}"; only text, resource_link${
            imagesEnabled ? ", image" : ""
          } are supported`,
        )
    }
  }
  if (parts.length === 0 && images.length === 0) {
    throw RequestError.invalidParams(undefined, "prompt contained no usable content")
  }
  return { parts, images }
}

// ponytail: flatten a resource link into text until the runner accepts a
// resource part. The URI is load-bearing; the label is for the model's benefit.
function resourceLinkText(link: ResourceLink): string {
  const label = link.title ?? link.name
  const note = link.description ? ` — ${link.description}` : ""
  return `[${label}](${link.uri})${note}`
}
