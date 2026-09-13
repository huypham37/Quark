import { agentFromProfile } from "../src/agent"
import { bootstrap, resetBootstrap } from "../src/bootstrap"
import { loadConfig, parseModelSpec, resetConfigCache } from "../src/config/config"
import { resolveProfile, readPromptFile, listProfiles, resetProfileCache, type ProfileDef } from "../src/profile/profile"
import { exportSessionToMarkdown } from "../src/commands/export"
import { undoLatest } from "../src/commands/undo"
import { dbToConversationMessages } from "../src/shared/conversation-view"
import { getLastInputTokens } from "../src/session/context"
import { bus, type BusEventName } from "../src/session/events"
import { loadMessages } from "../src/session/message"
import { cancel, isActive, prompt } from "../src/session/prompt"
import { compactBranch, createSteerBranch } from "../src/session/branch"
import { resolveModel } from "../src/provider/resolver"
import { clearCache as clearSkillCache, discoverSkills, loadSkill } from "../src/skill/skill"
import { clear as clearRegistry } from "../src/tool/registry"
import { createSession, getSession, listProjectSessions, type Session } from "../src/session/session"
import { respondQuestion } from "../src/tool/question"
import { getBranchFromPath } from "../src/worktree/worktree"
import { CatalogModelRuntime } from "../src/tui/catalog-model-runtime"

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

function sessionView(session: Session) {
  return {
    id: session.id,
    title: session.title ?? "New session",
    directory: session.directory,
    pinned: session.pinned,
    timeUpdated: session.timeUpdated,
    running: isActive(session.id),
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
  private agent: ReturnType<typeof agentFromProfile>
  private profile: ProfileDef
  private modelOverride: string | null = null
  private pendingSkillContext: string[] = []
  private activatedSkills = new Set<string>()

  private constructor(
    profile: ProfileDef,
    agent: ReturnType<typeof agentFromProfile>,
    private readonly catalog: CatalogModelRuntime,
  ) {
    this.profile = profile
    this.agent = agent
  }

  static async create(): Promise<WebBackend> {
    const profile = resolveProfile()
    const agent = agentFromProfile(profile, readPromptFile(profile).content)
    await bootstrap({ profileTools: profile.tools, boundSkills: profile.skills })
    const catalog = await CatalogModelRuntime.create()
    void catalog.refresh()
    return new WebBackend(profile, agent, catalog)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request)
    } catch (error) {
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
        url.pathname.startsWith("/api/profile") ||
        url.pathname.startsWith("/api/skill") || url.pathname === "/api/model" ||
        url.pathname === "/api/reload-config") {
      const control = await this.control(request, url.pathname)
      if (control) return control
    }

    if (segments[0] === "api" && segments[1] === "sessions" && segments[2]) {
      const sessionId = decodeURIComponent(segments[2])
      getSession(sessionId)

      if (request.method === "GET" && segments.length === 3) {
        return json({ session: sessionView(getSession(sessionId)), ...sessionData(sessionId) })
      }

      if (request.method === "GET" && segments[3] === "events") {
        return this.events(request, sessionId)
      }

      if (request.method === "POST" && segments[3] === "messages") {
        return this.send(request, sessionId)
      }

      if (request.method === "POST" && segments[3] === "cancel") {
        cancel(sessionId)
        return json({ cancelled: true })
      }

      if (request.method === "POST" && segments[3] === "undo") {
        const result = await undoLatest(sessionId)
        return json(result
          ? { undone: true, restored: result.restored, deleted: result.deleted }
          : { undone: false, restored: [], deleted: [] })
      }

      if (request.method === "POST" && segments[3] === "export") {
        return json(exportSessionToMarkdown(sessionId))
      }

      if (request.method === "POST" && segments[3] === "steer") {
        const body = await request.json() as { goal?: string }
        return this.branch("steer", sessionId, body.goal?.trim() ?? "")
      }

      if (request.method === "POST" && segments[3] === "compact") {
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

  /** Model, profile, skill, and config control routes. Returns null when the path is not one of ours. */
  private async control(request: Request, pathname: string): Promise<Response | null> {
    if (pathname === "/api/catalog" && request.method === "GET") {
      return json({
        profiles: listProfiles(),
        profile: this.profile.id,
        skills: discoverSkills().map((skill) => skill.name),
        activeSkills: this.activeSkills(),
      })
    }

    // Kept separate from /api/catalog: the model list is large, so the client
    // only fetches it when the model picker is actually opened.
    if (pathname === "/api/models" && request.method === "GET") {
      return json({ models: this.listModels() })
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
      return json({ modelName: this.modelName(), thinkingEffort: "none" })
    }

    if (pathname === "/api/profiles" && request.method === "GET") {
      return json({ profiles: listProfiles(), active: this.profile.id })
    }

    if (pathname === "/api/profile" && request.method === "POST") {
      const body = await request.json() as { name?: string }
      const name = body.name?.trim()
      if (!name) return json({ error: "A profile name is required" }, 400)
      if (!listProfiles().includes(name)) {
        return json({ error: `Profile "${name}" not found. Available: ${listProfiles().join(", ")}` }, 404)
      }
      await this.switchProfile(name)
      return json({ profile: this.profile.id, modelName: this.modelName() })
    }

    if (pathname === "/api/skills" && request.method === "GET") {
      return json({ skills: discoverSkills().map((skill) => skill.name), active: [...this.activatedSkills] })
    }

    if (pathname === "/api/skills" && request.method === "POST") {
      const body = await request.json() as { name?: string }
      const name = body.name?.trim()
      if (!name) return json({ error: "A skill name is required" }, 400)
      if (this.profile.skills.includes(name) || this.activatedSkills.has(name)) {
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
      resetProfileCache()
      await this.applyProfile(this.profile.id)
      this.catalog.reloadProviders()
      void this.catalog.refresh()
      return json({ reloaded: true, profile: this.profile.id, modelName: this.modelName() })
    }

    return null
  }

  /** Skills available to the next turn: profile-bound skills plus ones added this session. */
  private activeSkills(): string[] {
    return [...new Set([...this.profile.skills, ...this.activatedSkills])]
  }

  private listModels() {
    const models: Array<{ spec: string; name: string; provider: string }> = []
    for (const provider of this.catalog.catalog.listProviders()) {
      for (const model of this.catalog.catalog.listModels(provider.id)) {
        models.push({ spec: `${provider.id}/${model.id}`, name: model.name, provider: provider.name })
      }
    }
    return models.sort((a, b) => a.spec.localeCompare(b.spec))
  }

  private modelName(): string {
    return this.modelOverride ?? this.agent.model ?? loadConfig().modelConfig.small
  }

  /** Rebuilds the agent from a profile and re-registers its tools and skills. */
  private async applyProfile(profileId: string): Promise<void> {
    resetProfileCache()
    clearSkillCache()
    const profile = resolveProfile(profileId)
    this.profile = profile
    this.agent = agentFromProfile(profile, readPromptFile(profile).content)
    this.pendingSkillContext = []
    this.activatedSkills.clear()
    clearRegistry()
    resetBootstrap()
    await bootstrap({ profileTools: profile.tools, boundSkills: profile.skills })
  }

  private async switchProfile(name: string): Promise<void> {
    await this.applyProfile(name)
    this.modelOverride = null
  }

  private async branch(kind: "steer" | "compact", sessionId: string, goal: string): Promise<Response> {
    const { messages, parts } = loadMessages(sessionId)
    const result = kind === "steer"
      ? createSteerBranch({
          sessionId,
          prompt: goal || undefined,
          profile: this.profile.id,
          messages,
          parts,
        })
      : await compactBranch({
          sessionId,
          messages,
          parts,
          model: await resolveModel(loadConfig().modelConfig.small, "small", { catalog: this.catalog.catalog }),
          profile: this.profile.id,
          prompt: goal || undefined,
        })

    if (goal) {
      void prompt({
        sessionId: result.sessionId,
        parentSessionId: sessionId,
        parts: [{ type: "text", text: goal }],
        model: this.modelOverride ?? undefined,
        agent: this.agent,
        catalog: this.catalog.catalog,
      }).catch((error) => bus.emit("error", { sessionId: result.sessionId, error }))
    }

    return json({ sessionId: result.sessionId, kind, modelName: this.modelName() })
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

    const modelName = this.modelName()
    const parsed = parseModelSpec(modelName)
    const model = parsed.provider ? this.catalog.catalog.getModel(parsed.provider, parsed.model) : null

    const data = session ? sessionData(session.id) : { messages: [], tokensUsed: 0 }
    return {
      session: session ? sessionView(session) : null,
      sessions: sessions.map(sessionView),
      ...data,
      status: {
        modelName,
        thinkingEffort: this.modelOverride ? "none" : this.agent.thinkingEffort ?? "none",
        tokenLimit: model?.limit.context ?? model?.limit.input ?? 0,
        cwd: process.cwd(),
        branch: getBranchFromPath(process.cwd()),
        profile: this.profile.id,
      },
    }
  }

  private async send(request: Request, sessionId: string): Promise<Response> {
    if (isActive(sessionId)) return json({ error: "This session is already running" }, 409)
    const body = await request.json() as { text?: string }
    const text = body.text?.trim()
    if (!text) return json({ error: "Message text is required" }, 400)

    const skillContext = this.pendingSkillContext.join("\n")
    this.pendingSkillContext = []

    void prompt({
      sessionId,
      parts: [{ type: "text", text }],
      ...(skillContext ? { modelOnlyText: skillContext } : {}),
      model: this.modelOverride ?? undefined,
      agent: this.agent,
      catalog: this.catalog.catalog,
    }).catch((error) => bus.emit("error", { sessionId, error }))

    return json({ sessionId }, 202)
  }

  private events(request: Request, sessionId: string): Response {
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
          for (const { event, handler } of listeners) bus.off(event as any, handler)
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
          bus.on(event as any, handler)
        }

        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
        request.signal.addEventListener("abort", cleanup, { once: true })
        write("connected", { sessionId })
      },
      cancel: () => {
        clearInterval(heartbeat)
        for (const { event, handler } of listeners) bus.off(event as any, handler)
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
