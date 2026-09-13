import { agentFromProfile } from "../src/agent"
import { bootstrap } from "../src/bootstrap"
import { loadConfig, parseModelSpec } from "../src/config/config"
import { resolveProfile, readPromptFile } from "../src/profile/profile"
import { exportSessionToMarkdown } from "../src/commands/export"
import { undoLatest } from "../src/commands/undo"
import { dbToConversationMessages } from "../src/shared/conversation-view"
import { getLastInputTokens } from "../src/session/context"
import { bus, type BusEventName } from "../src/session/events"
import { loadMessages } from "../src/session/message"
import { cancel, isActive, prompt } from "../src/session/prompt"
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
  private constructor(
    private readonly agent: ReturnType<typeof agentFromProfile>,
    private readonly catalog: CatalogModelRuntime,
  ) {}

  static async create(): Promise<WebBackend> {
    const profile = resolveProfile()
    const agent = agentFromProfile(profile, readPromptFile(profile).content)
    await bootstrap({ profileTools: profile.tools, boundSkills: profile.skills })
    const catalog = await CatalogModelRuntime.create()
    void catalog.refresh()
    return new WebBackend(agent, catalog)
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
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "questions" && segments[2]) {
      const body = await request.json() as { answers?: string[][]; rejected?: boolean }
      respondQuestion({ requestId: decodeURIComponent(segments[2]), ...body })
      return json({ answered: true })
    }

    return json({ error: "Not found" }, 404)
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

    const modelName = this.agent.model ?? loadConfig().modelConfig.small
    const parsed = parseModelSpec(modelName)
    const model = parsed.provider ? this.catalog.catalog.getModel(parsed.provider, parsed.model) : null

    const data = session ? sessionData(session.id) : { messages: [], tokensUsed: 0 }
    return {
      session: session ? sessionView(session) : null,
      sessions: sessions.map(sessionView),
      ...data,
      status: {
        modelName,
        thinkingEffort: this.agent.thinkingEffort ?? "none",
        tokenLimit: model?.limit.context ?? model?.limit.input ?? 0,
        cwd: process.cwd(),
        branch: getBranchFromPath(process.cwd()),
      },
    }
  }

  private async send(request: Request, sessionId: string): Promise<Response> {
    if (isActive(sessionId)) return json({ error: "This session is already running" }, 409)
    const body = await request.json() as { text?: string }
    const text = body.text?.trim()
    if (!text) return json({ error: "Message text is required" }, 400)

    void prompt({
      sessionId,
      parts: [{ type: "text", text }],
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
