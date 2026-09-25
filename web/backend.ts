import { randomUUID } from "node:crypto"
import { reserveLiveTurn, isLiveTurn } from "../packages/runner/src/session/live-turn"
import { join } from "node:path"
import { materializeAgent, resolveAgent, listAgents, type AgentDef } from "../packages/quark/src/agent/agent"
import { loadConfig, parseModelSpec, resetConfigCache } from "../packages/quark/src/config/config"
import { loadAmbientInstructions } from "../packages/quark/src/ambient"
import { loadPlugins } from "../packages/quark/src/plugin-loader"
import { ensureStorageRoot } from "../packages/runner/src/storage/session-jsonl"
import { getSessionStorageRoot } from "../packages/runner/src/storage/session-path"
import type { AgentDefinition } from "../packages/runner/src/agent"
import { createRunner, type Runner } from "../packages/runner/src/runner"
import { exportSessionToMarkdown } from "../packages/runner/src/commands/export"
import { undoLatest } from "../packages/runner/src/commands/undo"
import { dbToConversationMessages } from "../packages/runner/src/shared/conversation-view"
import { getLastInputTokens } from "../packages/runner/src/session/context"
import { bus, type BusEventName, type TypedBus } from "../packages/runner/src/session/events"
import { loadMessages } from "../packages/runner/src/session/message"
import { cancel, isActive, prompt } from "../packages/runner/src/session/prompt"
import { compactBranch, createSteerBranch } from "../packages/runner/src/session/branch"
import { resolveModel } from "../packages/runner/src/provider/resolver"
import { clearCache as clearSkillCache, discoverSkills, loadSkill } from "../packages/runner/src/skill/skill"
import { createJsonlSessionStore, createSession, getSession, listProjectSessions, type Session } from "../packages/runner/src/session/session"
import { respondQuestion } from "../packages/runner/src/tool/question"
import { getBranchFromPath } from "../packages/runner/src/worktree/worktree"
import { CatalogModelRuntime } from "../packages/quark/src/tui/catalog-model-runtime"
import { buildModelPickerOptions } from "../packages/quark/src/tui/model-picker"
import { thinkingCapabilityFromCatalog } from "../packages/runner/src/provider/catalog-runtime"

const streamEvents: BusEventName[] = [
  "user-message",
  "assistant-message-start",
  "text-start",
  "text-delta",
  "text-end",
  "tool-start",
  "tool-input",
  "tool-running",
  "tool-end",
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
  "step-finish",
  "assistant-message-end",
  "user-message-status",
  "loop-start",
  "loop-end",
  "question-request",
  "retry",
  "error",
  "context-too-long",
  "session-title-changed",
  "session-switch",
  "subagent-tool-start",
  "subagent-tool-input",
  "subagent-tool-running",
  "subagent-tool-end",
  "subagent-step-finish",
  "subagent-text-delta",
  "subagent-done",
  "subagent-error",
]

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Request body limits + validation
//
// The body is bounded *before* it is buffered, so a large or lying
// Content-Length cannot make the server allocate unbounded memory. Image
// attachments are validated strictly here (canonical base64, supported MIME)
// so the engine only ever sees well-formed parts.
// ---------------------------------------------------------------------------

/** Total wire-size ceiling for a JSON request body. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024 // 10 MiB

/** Max image attachments per message, and the decoded ceiling for each. */
export const MAX_IMAGES = 8
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MiB decoded (reachable within MAX_BODY_BYTES)

/** MIME types the engine's image pipeline supports (see runner tool/look.ts). */
export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const

/**
 * Ceiling on concurrently registered remote runners. At the cap an *idle*
 * runner (no in-flight turn) is evicted oldest-first; if every runner is busy
 * the create is refused, so the registry can never grow without bound.
 */
export const MAX_RUNNERS = 100

/**
 * On-disk namespace shared by *all* remote runners: one directory under the
 * session storage root.
 *
 * Sessions outlive any single runner, so every runner's store points here and a
 * newly minted runner resumes a prior session by ID. It is deliberately separate
 * from the legacy `/api/sessions` store: a runner's history never shows up in
 * (or gets mutated through) the main app.
 */
export function runnerSessionsRoot(): string {
  return join(getSessionStorageRoot(), "runners")
}

/** An HTTP error the route layer should answer with its status. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "HttpError"
  }
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${n / (1024 * 1024)} MiB` : `${Math.ceil(n / 1024)} KiB`
}

/**
 * Read a JSON request body, enforcing `limit` before buffering it all.
 *
 * An over-limit Content-Length is rejected up front; the streamed size is
 * checked too, so a missing or lying Content-Length cannot bypass the cap.
 * Throws {@link HttpError} (413 over limit, 400 malformed body).
 */
export async function readJsonBody(request: Request, limit = MAX_BODY_BYTES): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared !== null) {
    const declaredBytes = Number(declared)
    if (!Number.isInteger(declaredBytes) || declaredBytes < 0) {
      throw new HttpError(400, "Invalid Content-Length header")
    }
    if (declaredBytes > limit) {
      throw new HttpError(413, `Request body too large (limit ${formatBytes(limit)})`)
    }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  const stream = request.body
  if (stream) {
    const reader = stream.getReader()
    // ponytail: byte cap only; a 1-byte-chunk flood still costs per-chunk
    // overhead. Coalesce chunks (or cap their count) if that ever matters.
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        throw new HttpError(413, `Request body too large (limit ${formatBytes(limit)})`)
      }
      chunks.push(value)
    }
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    throw new HttpError(400, "Invalid JSON body")
  }
}

/** Decode canonical standard base64, or null when the input is not canonical. */
function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null
  const decoded = Buffer.from(value, "base64")
  // Buffer.from is permissive (accepts stray bits / missing padding); re-encoding
  // and comparing rejects anything that isn't exactly what we'd send back.
  return decoded.toString("base64") === value ? decoded : null
}

export interface MessageInput {
  text: string
  images: { mime: string; data: string }[]
}

/**
 * Validate the parsed `/messages` body. Text remains required (unchanged
 * behavior); images are optional, but when present must be an array of
 * supported, canonically base64-encoded images. Throws {@link HttpError} (400)
 * naming the offending `images[index]`.
 */
export function validateMessageInput(body: unknown): MessageInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object")
  }

  const record = body as Record<string, unknown>
  if (typeof record.text !== "string") {
    throw new HttpError(400, "Message text is required")
  }
  const text = record.text.trim()
  if (!text) throw new HttpError(400, "Message text is required")

  return { text, images: validateImages(record.images) }
}

/** The prompt() input fragment for a validated message. */
export function messagePromptInput(input: MessageInput): {
  parts: { type: "text"; text: string }[]
  images?: MessageInput["images"]
} {
  return {
    parts: [{ type: "text", text: input.text }],
    // Images only when present, so text-only messages keep their exact shape.
    ...(input.images.length ? { images: input.images } : {}),
  }
}

/** `agentId` from a POST /api/runners body; undefined selects the configured default. */
function readAgentId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object")
  }
  const value = (body as Record<string, unknown>).agentId
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "agentId must be a non-empty string")
  }
  return value.trim()
}

/**
 * Session IDs are used as single path segments under the shared runner
 * namespace. Restrict them to the alphabet the engine generates (nanoid:
 * `A-Za-z0-9_-`) so a caller can never traverse out of that namespace.
 */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** `sessionId` from a runner prompt body; undefined asks the runner to create one. */
function readSessionId(body: unknown): string | undefined {
  const value = (body as Record<string, unknown>).sessionId
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "sessionId must be a non-empty string")
  }
  const id = value.trim()
  if (!isSafeSessionId(id)) {
    throw new HttpError(400, "sessionId must match [A-Za-z0-9_-]+")
  }
  return id
}

function validateImages(input: unknown): MessageInput["images"] {
  if (input == null) return []
  if (!Array.isArray(input)) throw new HttpError(400, "images must be an array")
  if (input.length === 0) return []
  if (input.length > MAX_IMAGES) {
    throw new HttpError(400, `Too many images (max ${MAX_IMAGES})`)
  }

  return input.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new HttpError(400, `images[${index}] must be an object with mime and data`)
    }
    const { mime, data } = item as Record<string, unknown>
    if (typeof mime !== "string" || !(SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime)) {
      throw new HttpError(
        400,
        `images[${index}] has unsupported mime "${String(mime)}". Supported: ${SUPPORTED_IMAGE_MIMES.join(", ")}`,
      )
    }
    const decoded = typeof data === "string" ? decodeCanonicalBase64(data) : null
    if (!decoded) {
      throw new HttpError(400, `images[${index}] data must be canonical base64`)
    }
    if (decoded.byteLength > MAX_IMAGE_BYTES) {
      throw new HttpError(400, `images[${index}] is too large (max ${formatBytes(MAX_IMAGE_BYTES)})`)
    }
    return { mime, data: data as string }
  })
}

function sessionView(session: Session, running = isActive(session.id)) {
  return {
    id: session.id,
    title: session.title ?? "New session",
    directory: session.directory,
    pinned: session.pinned,
    timeUpdated: session.timeUpdated,
    running,
  }
}

function sessionData(sessionId: string) {
  const loaded = loadMessages(sessionId)
  const times = new Map(loaded.messages.map((message) => [message.id, message.timeCreated]))
  return {
    messages: dbToConversationMessages(loaded.messages, loaded.parts).map((message) => ({
      ...message,
      timeCreated: times.get(message.id),
    })),
    tokensUsed: getLastInputTokens(loaded.parts),
  }
}

export class WebBackend {
  private agent: AgentDefinition
  private agentDef: AgentDef
  private modelOverride: string | null = null
  private thinkingOverride: string | null = null
  private pendingSkillContext: string[] = []
  private activatedSkills = new Set<string>()
  /**
   * Process-local registry of remote runner instances (POST /api/runners).
   *
   * A runner is an ephemeral execution handle: its own event bus, cancellation
   * map, and hook registry, so runners never share listeners or abort state.
   * Sessions are *not* owned by a runner — they are persistent, share one
   * on-disk namespace ({@link runnerSessionsRoot}), and outlive the runner.
   *
   * The registry itself is in-memory: runner IDs are minted per process, so a
   * server restart ends every runner. The session files remain on disk, so a
   * newly minted runner resumes any prior session by ID.
   */
  private readonly runners = new Map<string, Runner>()

  /**
   * Session IDs with an in-flight turn, mapped to the runner that owns the run.
   *
   * All runners share one session namespace, so a session ID is a process-wide
   * resource: this is the cross-runner guard that stops two runners from
   * interleaving writes into the same history. The owner is recorded so
   * cancel/events address the runner actually running the turn, whichever
   * runner's path the caller used.
   *
   * ponytail: process-local. Two server processes sharing a session root could
   * still race; move the guard to a file lock / advisory lock on the session
   * dir if multi-process deployment is ever needed.
   */
  private readonly activeSessions = new Map<string, Runner>()

  private constructor(
    agentDef: AgentDef,
    agent: AgentDefinition,
    private readonly catalog: CatalogModelRuntime,
  ) {
    this.agentDef = agentDef
    this.agent = agent
  }

  static async create(): Promise<WebBackend> {
    const agentDef = resolveAgent()
    const agent = await materializeAgent(agentDef)
    ensureStorageRoot()
    await loadPlugins()
    const catalog = await CatalogModelRuntime.create()
    void catalog.refresh()
    return new WebBackend(agentDef, agent, catalog)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.error("[web]", error)
      return json({ error: errorMessage(error) }, 500)
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean)

    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(this.state(url.searchParams.get("sessionId")))
    }

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      return json({ session: sessionView(createSession()) }, 201)
    }

    if (url.pathname.startsWith("/api/catalog") || url.pathname === "/api/models" ||
        url.pathname === "/api/thinking" ||
        url.pathname.startsWith("/api/agent") ||
        url.pathname.startsWith("/api/skill") || url.pathname === "/api/model" ||
        url.pathname === "/api/reload-config") {
      const control = await this.control(request, url.pathname)
      if (control) return control
    }

    if (segments[0] === "api" && segments[1] === "runners") {
      return this.runnerRoute(request, segments, url.pathname)
    }

    if (segments[0] === "api" && segments[1] === "sessions" && segments[2]) {
      const sessionId = decodeURIComponent(segments[2])
      getSession(sessionId)

      if (request.method === "GET" && segments.length === 3) {
        return json({ session: sessionView(getSession(sessionId)), ...sessionData(sessionId) })
      }

      // Each verb is matched at exactly one segment, so trailing junk
      // (/api/sessions/:id/messages/extra) is a 404, not a second entry point.
      if (request.method === "GET" && segments.length === 4 && segments[3] === "events") {
        return this.events(request, sessionId)
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "messages") {
        return this.send(request, sessionId)
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "cancel") {
        cancel(sessionId)
        return json({ cancelled: true })
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "undo") {
        const result = await undoLatest(sessionId)
        return json(result
          ? { undone: true, restored: result.restored, deleted: result.deleted }
          : { undone: false, restored: [], deleted: [] })
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "export") {
        return json(exportSessionToMarkdown(sessionId))
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "steer") {
        const body = await request.json() as { goal?: string }
        return this.branch("steer", sessionId, body.goal?.trim() ?? "")
      }

      if (request.method === "POST" && segments.length === 4 && segments[3] === "compact") {
        const body = await request.json() as { goal?: string }
        return this.branch("compact", sessionId, body.goal?.trim() ?? "")
      }
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "questions" && segments[2]) {
      const body = await request.json() as { answers?: string[][]; rejected?: boolean }
      respondQuestion({ requestId: decodeURIComponent(segments[2]), ...body })
      return json({ answered: true })
    }

    return json({ error: "Not found" }, 404)
  }

  // -------------------------------------------------------------------------
  // Remote runner API
  //
  // Runners are isolated *execution* instances: own bus, own cancellation state,
  // own hooks. Sessions are shared, persistent state in one disk namespace, so a
  // runner never owns history — any runner can resume any session by ID.
  // POST /api/runners mints a runner and returns its runnerId; the caller echoes
  // that id (plus a sessionId) on later calls. Runners reuse the shared prompt
  // implementation, but always against their own isolated runtime (own bus,
  // store, hooks) — the process-global module-level singleton is never touched.
  // -------------------------------------------------------------------------

  private async runnerRoute(request: Request, segments: string[], pathname: string): Promise<Response> {
    const runnerId = segments[2] ? decodeURIComponent(segments[2]) : null
    if (!runnerId) {
      // Only the exact collection path mints a runner: a trailing slash
      // (/api/runners/) is a 404, not a second entry point.
      if (pathname === "/api/runners" && request.method === "POST") return this.runnerCreate(request)
      return json({ error: "Not found" }, 404)
    }

    const runner = this.runners.get(runnerId)
    if (!runner) return json({ error: `Unknown runner: ${runnerId}` }, 404)

    if (segments.length === 3 && request.method === "DELETE") {
      return this.runnerDelete(runnerId, runner)
    }

    if (segments.length === 5 && segments[3] === "session" && segments[4] === "prompt" && request.method === "POST") {
      return this.runnerPrompt(request, runnerId, runner)
    }

    const sessionId = segments[3] === "sessions" && segments[4] ? decodeURIComponent(segments[4]) : null
    if (sessionId && !isSafeSessionId(sessionId)) return json({ error: "Invalid session id" }, 400)
    if (sessionId) {
      if (segments.length === 5 && request.method === "GET") {
        return this.runnerSession(runnerId, runner, sessionId)
      }
      if (segments.length === 6 && segments[5] === "events" && request.method === "GET") {
        if (!runner.store.get(sessionId)) return json({ error: "Session not found" }, 404)
        // Sessions are shared: stream from whichever runner owns the active
        // turn, falling back to the one addressed when nothing is running.
        return this.events(request, sessionId, (this.activeSessions.get(sessionId) ?? runner).bus)
      }
      if (segments.length === 6 && segments[5] === "cancel" && request.method === "POST") {
        if (!runner.store.get(sessionId)) return json({ error: "Session not found" }, 404)
        // Cancel the runner actually running the turn, so a cancel issued
        // through a different runner isn't a silent no-op.
        const owner = this.activeSessions.get(sessionId) ?? runner
        owner.cancel(sessionId)
        return json({ cancelled: true })
      }
    }

    return json({ error: "Not found" }, 404)
  }

  /**
   * Create a runner bound to a configured agent. Only an agent id is accepted:
   * tool definitions are materialized from disk, never supplied over HTTP.
   */
  private async runnerCreate(request: Request): Promise<Response> {
    const agentId = readAgentId(request.body ? await readJsonBody(request) : {})
    if (agentId && !listAgents().includes(agentId)) {
      throw new HttpError(404, `Agent "${agentId}" not found. Available: ${listAgents().join(", ")}`)
    }

    const agent = await materializeAgent(resolveAgent(agentId))
    const config = loadConfig()

    // Bound the registry before the (synchronous) insert: evict the oldest idle
    // runner, or refuse when every runner has a turn in flight. Because the
    // check and the set share one event-loop turn, concurrent creates cannot
    // race past the cap.
    if (this.runners.size >= MAX_RUNNERS) {
      const idle = [...this.runners].find(([, candidate]) => !candidate.hasActiveRun())
      if (!idle) return json({ error: `Runner limit (${MAX_RUNNERS}) reached` }, 503)
      this.dropRunner(idle[0])
    }

    const runnerId = randomUUID()
    this.runners.set(runnerId, createRunner({
      agent,
      // Every runner's store points at the one shared namespace, so sessions
      // outlive the runner: a new runner resumes a prior session by ID.
      store: createJsonlSessionStore(runnerSessionsRoot()),
      // Fresh isolated bus/hooks are the portable defaults; no eventBus passed.
      ambientInstructions: loadAmbientInstructions,
      policies: {
        maxSteps: config.maxSteps,
        branching: config.branching,
        smallModel: config.models.small,
        // Undo snapshots use the *global* session root (not the runner
        // namespace), so keep them off for remote runners.
        undo: false,
      },
      // Custom providers so the portable path resolves real models.
      resolve: { providers: config.providers, catalog: this.catalog.catalog },
    }))
    return json({ runnerId }, 201)
  }

  /**
   * Drop an idle runner from the registry.
   *
   * Sessions are shared, persistent state that outlives the runner, so this
   * never touches disk: another runner (now or after a restart) resumes any
   * session by ID. Called on DELETE and on eviction at the {@link MAX_RUNNERS}
   * cap.
   */
  private dropRunner(runnerId: string): void {
    this.runners.delete(runnerId)
  }

  /**
   * Delete a runner. Its sessions stay on disk.
   *
   * Refuses with 409 while a turn is in flight: removing a runner with an
   * active run would orphan its abort controller and leak the run (see
   * {@link Runner.hasActiveRun}). Cancel the session(s) first, then delete.
   */
  private runnerDelete(runnerId: string, runner: Runner): Response {
    if (runner.hasActiveRun()) {
      return json({ error: "Runner has an active run; cancel it before deleting" }, 409)
    }
    this.dropRunner(runnerId)
    return json({ deleted: true, runnerId })
  }

  /**
   * Run a prompt on a runner (`POST /api/runners/:id/session/prompt`).
   *
   * The session is created in the shared disk-backed store *synchronously*,
   * before the turn starts, so the 202 always carries a final sessionId — even
   * for a brand-new conversation — and the caller can address the session
   * (subscribe, cancel) while the model runs. The turn is otherwise
   * fire-and-forget; a failure surfaces on the runner's isolated bus as an
   * `error` event.
   *
   * Concurrent runs on one session are refused with 409 *across all runners*
   * (they share one namespace), so two turns can never interleave writes into
   * the same history. Cancel the session, then prompt again.
   */
  private async runnerPrompt(request: Request, runnerId: string, runner: Runner): Promise<Response> {
    const body = await readJsonBody(request)
    const input = validateMessageInput(body)
    const requested = readSessionId(body)

    // Reuse an existing session; otherwise mint one now (matching the store's
    // createOnMissing semantics). The store guard avoids clobbering a session
    // created by an overlapping request.
    const sessionId = requested && runner.store.get(requested)
      ? requested
      : createSession(requested ? { id: requested } : undefined, runner.store).id

    // One turn per session across all runners. `runner.isActive` covers a turn
    // started directly on this runner; the global map covers one started
    // through another runner. Both checks and the reservation share one
    // event-loop turn (no await between), so a racing duplicate cannot slip in.
    if (runner.isActive(sessionId) || this.activeSessions.has(sessionId)) {
      return json({ error: "This session is already running" }, 409)
    }
    const release = reserveLiveTurn(sessionId, runnerSessionsRoot(), runner.bus)
    if (!release) return json({ error: "This session is already running" }, 409)
    this.activeSessions.set(sessionId, runner)

    runner
      .prompt({ sessionId, ...messagePromptInput(input) })
      .catch((error) => { runner.bus.emit("error", { sessionId, error }) })
      .finally(() => {
        if (this.activeSessions.get(sessionId) === runner) this.activeSessions.delete(sessionId)
        release()
      })

    return json({ runnerId, sessionId }, 202)
  }

  /** Read a shared session and its conversation through a runner's store. */
  private runnerSession(runnerId: string, runner: Runner, sessionId: string): Response {
    const session = runner.store.get(sessionId)
    if (!session) return json({ error: "Session not found" }, 404)

    const loaded = loadMessages(sessionId, runner.store)
    const times = new Map(loaded.messages.map((message) => [message.id, message.timeCreated]))
    return json({
      runnerId,
      // Sessions are shared: a turn started through another runner still shows
      // as running, so the flag matches what cancel/events would address.
      session: sessionView(session, isLiveTurn(sessionId, runnerSessionsRoot()) || this.activeSessions.has(sessionId) || runner.isActive(sessionId)),
      messages: dbToConversationMessages(loaded.messages, loaded.parts).map((message) => ({
        ...message,
        timeCreated: times.get(message.id),
      })),
      tokensUsed: getLastInputTokens(loaded.parts),
    })
  }

  /** Model, agent, skill, and config control routes. Returns null when the path is not one of ours. */
  private async control(request: Request, pathname: string): Promise<Response | null> {
    if (pathname === "/api/catalog" && request.method === "GET") {
      return json({
        agents: listAgents(),
        agent: this.agentDef.id,
        skills: discoverSkills().map((skill) => skill.name),
        activeSkills: this.activeSkills(),
      })
    }

    // Kept separate from /api/catalog: the model list is large, so the client
    // only fetches it when the model picker is actually opened. Reuses the
    // TUI picker so only authenticated providers contribute models.
    if (pathname === "/api/models" && request.method === "GET") {
      await this.catalog.active.refresh()
      return json({ models: buildModelPickerOptions(this.catalog.active, this.catalog.catalog) })
    }

    if (pathname === "/api/model" && request.method === "POST") {
      const body = await request.json() as { spec?: string }
      const spec = body.spec?.trim()
      if (!spec) return json({ error: "A model spec is required, e.g. provider/model" }, 400)
      const parsed = parseModelSpec(spec)
      if (parsed.provider && !this.catalog.catalog.getModel(parsed.provider, parsed.model)) {
        return json({ error: `Unknown model: ${spec}` }, 404)
      }
      this.modelOverride = spec
      return json({ status: this.status() })
    }

    if (pathname === "/api/thinking" && request.method === "POST") {
      const body = await request.json() as { effort?: string | null }
      // A null effort clears the override and falls back to the profile default.
      if (body.effort == null) {
        this.thinkingOverride = null
        return json({ status: this.status() })
      }
      const effort = body.effort.trim()
      const levels = this.thinkingLevels()
      if (!levels.includes(effort)) {
        return json({ error: `Unsupported thinking effort "${effort ?? ""}". Available: ${levels.join(", ")}` }, 400)
      }
      this.thinkingOverride = effort
      return json({ status: this.status() })
    }

    if (pathname === "/api/agents" && request.method === "GET") {
      return json({ agents: listAgents(), active: this.agentDef.id })
    }

    if (pathname === "/api/agent" && request.method === "POST") {
      const body = await request.json() as { name?: string }
      const name = body.name?.trim()
      if (!name) return json({ error: "An agent name is required" }, 400)
      if (!listAgents().includes(name)) {
        return json({ error: `Agent "${name}" not found. Available: ${listAgents().join(", ")}` }, 404)
      }
      await this.switchAgent(name)
      return json({ status: this.status() })
    }

    if (pathname === "/api/skills" && request.method === "GET") {
      return json({ skills: discoverSkills().map((skill) => skill.name), active: [...this.activatedSkills] })
    }

    if (pathname === "/api/skills" && request.method === "POST") {
      const body = await request.json() as { name?: string }
      const name = body.name?.trim()
      if (!name) return json({ error: "A skill name is required" }, 400)
      if (this.agentDef.skills.includes(name) || this.activatedSkills.has(name)) {
        return json({
          activated: false,
          reason: `Skill "${name}" is already available`,
          active: this.activeSkills(),
        })
      }
      const skill = loadSkill(name)
      if (!skill) return json({ error: `Skill "${name}" not found` }, 404)
      this.activatedSkills.add(name)
      this.pendingSkillContext.push(
        `[Activated skill]\n${skill.name}: ${skill.description || "No description provided."}\nUse the skill tool to load it when needed.`,
      )
      return json({ activated: true, active: this.activeSkills() })
    }

    if (pathname === "/api/reload-config" && request.method === "POST") {
      resetConfigCache()
      await this.applyAgent(this.agentDef.id)
      this.catalog.reloadProviders()
      void this.catalog.refresh()
      this.thinkingOverride = null
      return json({ reloaded: true, status: this.status() })
    }

    return null
  }

  /** Skills available to the next turn: agent-bound skills plus ones added this session. */
  private activeSkills(): string[] {
    return [...new Set([...this.agentDef.skills, ...this.activatedSkills])]
  }

  private modelName(): string {
    return this.modelOverride ?? this.agent.model ?? loadConfig().models.small
  }

  /** Catalog record for the effective model, when the catalog knows it. */
  private catalogModel() {
    const parsed = parseModelSpec(this.modelName())
    return parsed.provider ? this.catalog.catalog.getModel(parsed.provider, parsed.model) : null
  }

  /** Thinking levels the effective model accepts; always includes "none" first. */
  private thinkingLevels(): string[] {
    const model = this.catalogModel()
    return model ? thinkingCapabilityFromCatalog(model)?.levels ?? ["none"] : ["none"]
  }

  private thinkingEffort(): string {
    const levels = this.thinkingLevels()
    const candidate = this.thinkingOverride ?? this.agent.thinkingEffort ?? "none"
    return levels.includes(candidate) ? candidate : levels[0] ?? "none"
  }

  /** Agent bound to the effective model and thinking effort for the next turn. */
  private requestAgent() {
    return { ...this.agent, thinkingEffort: this.thinkingEffort() }
  }

  private status() {
    const modelName = this.modelName()
    const model = this.catalogModel()
    return {
      modelName,
      modelLabel: model?.name ?? modelName,
      thinkingEffort: this.thinkingEffort(),
      thinkingLevels: this.thinkingLevels(),
      tokenLimit: model?.limit.context ?? model?.limit.input ?? 0,
      cwd: process.cwd(),
      branch: getBranchFromPath(process.cwd()),
      agent: this.agentDef.id,
    }
  }

  /** Rebuilds the agent from a manifest and reloads its tools and skills. */
  private async applyAgent(agentId: string): Promise<void> {
    clearSkillCache()
    this.agentDef = resolveAgent(agentId)
    this.agent = await materializeAgent(this.agentDef)
    this.pendingSkillContext = []
    this.activatedSkills.clear()
  }

  private async switchAgent(name: string): Promise<void> {
    await this.applyAgent(name)
    this.modelOverride = null
    this.thinkingOverride = null
  }

  private async branch(kind: "steer" | "compact", sessionId: string, goal: string): Promise<Response> {
    const { messages, parts } = loadMessages(sessionId)
    const result = kind === "steer"
      ? createSteerBranch({
          sessionId,
          prompt: goal || undefined,
          profile: this.agentDef.id,
          messages,
          parts,
        })
      : await compactBranch({
          sessionId,
          messages,
          parts,
          model: await resolveModel(loadConfig().models.small, "small", { catalog: this.catalog.catalog }),
          profile: this.agentDef.id,
          prompt: goal || undefined,
        })

    if (goal) {
      void prompt({
        sessionId: result.sessionId,
        parentSessionId: sessionId,
        parts: [{ type: "text", text: goal }],
        model: this.modelOverride ?? undefined,
        agent: this.requestAgent(),
        ambientInstructions: loadAmbientInstructions,
        catalog: this.catalog.catalog,
      }).catch((error) => bus.emit("error", { sessionId: result.sessionId, error }))
    }

    return json({ sessionId: result.sessionId, kind, status: this.status() })
  }

  private state(requestedId: string | null) {
    const sessions = listProjectSessions()
    let session: Session | null = null
    if (requestedId) {
      try {
        session = getSession(requestedId)
      } catch {}
    }
    session ??= sessions[0] ?? null

    const data = session ? sessionData(session.id) : { messages: [], tokensUsed: 0 }
    return {
      session: session ? sessionView(session) : null,
      sessions: sessions.map((session) => sessionView(session)),
      ...data,
      status: this.status(),
    }
  }

  private async send(request: Request, sessionId: string): Promise<Response> {
    if (isActive(sessionId)) return json({ error: "This session is already running" }, 409)
    // Validate before touching pendingSkillContext or prompt(): bad input must
    // not consume skill context or start a turn.
    const input = validateMessageInput(await readJsonBody(request))

    const skillContext = this.pendingSkillContext.join("\n")
    this.pendingSkillContext = []

    void prompt({
      sessionId,
      ...messagePromptInput(input),
      ...(skillContext ? { modelOnlyText: skillContext } : {}),
      model: this.modelOverride ?? undefined,
      agent: this.requestAgent(),
      ambientInstructions: loadAmbientInstructions,
      catalog: this.catalog.catalog,
    }).catch((error) => bus.emit("error", { sessionId, error }))

    return json({ sessionId }, 202)
  }

  private events(request: Request, sessionId: string, source: TypedBus = bus): Response {
    const encoder = new TextEncoder()
    const listeners: Array<{ event: BusEventName; handler: (data: any) => void }> = []
    let heartbeat: ReturnType<typeof setInterval>

    const body = new ReadableStream({
      start: (controller) => {
        const write = (type: string, data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`))
        }
        const cleanup = () => {
          clearInterval(heartbeat)
          for (const { event, handler } of listeners) source.off(event as any, handler)
          try { controller.close() } catch {}
        }

        for (const event of streamEvents) {
          const handler = (data: any) => {
            const isSessionSwitch = event === "session-switch"
            if (!isSessionSwitch && data?.sessionId && data.sessionId !== sessionId) return
            if (data?.error) data = { ...data, error: errorMessage(data.error) }
            write(event, data)
          }
          listeners.push({ event, handler })
          source.on(event as any, handler)
        }

        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
        request.signal.addEventListener("abort", cleanup, { once: true })
        write("connected", { sessionId })
      },
      cancel: () => {
        clearInterval(heartbeat)
        for (const { event, handler } of listeners) source.off(event as any, handler)
      },
    })

    return new Response(body, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
      },
    })
  }
}
