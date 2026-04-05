import { bootstrap } from "../bootstrap"
import { prompt, cancel } from "../session/prompt"
import { bus, type BusEventName } from "../session/events"
import { createSession, listSessions, getSession } from "../session/session"
import { loadMessages } from "../session/message"
import { dbToTuiMessages } from "../tui/state"
import { resolveProfile, readPromptFile, listProfiles } from "../profile/profile"
import { agentFromProfile } from "../agent"
import type { AgentConfig } from "../agent"
import { loadConfig, parseModelSpec, getProviderId } from "../config/config"
import { respond as respondPermission } from "../permission/permission"
import type { Reply } from "../permission/permission"
import type { ServerWebSocket } from "bun"

const ALL_EVENTS: BusEventName[] = [
  "text-start", "text-delta", "text-end",
  "tool-start", "tool-input", "tool-end",
  "step-start", "step-finish",
  "assistant-message-start", "assistant-message-end",
  "loop-start", "loop-end",
  "error", "session-created", "session-reset", "session-switch",
  "permission-request",
  "compaction-start", "compaction-end",
  "retry",
  "reasoning-start", "reasoning-delta", "reasoning-end",
  "user-message",
  "subagent-tool-start", "subagent-tool-input", "subagent-tool-end",
  "subagent-step-finish", "subagent-text-delta", "subagent-done",
]

type WSData = { handlers: Map<BusEventName, (data: unknown) => void> }

function cors(headers?: Record<string, string>): Headers {
  const h = new Headers(headers)
  h.set("Access-Control-Allow-Origin", "*")
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  h.set("Access-Control-Allow-Headers", "Content-Type")
  return h
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json" }),
  })
}

function notFound(): Response {
  return json({ error: "Not found" }, 404)
}

function createRequestHandler(agent: AgentConfig) {
  // Runtime model override — not persisted, same as TUI /model command
  let modelOverride: string | null = null

  function getModelOpt() {
    if (!modelOverride) return undefined
    const parsed = parseModelSpec(modelOverride)
    return { provider: parsed.provider ?? getProviderId("main"), model: parsed.model }
  }

  return async function handleRequest(
    req: Request,
    server: { upgrade(req: Request, opts?: unknown): boolean },
  ): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() })
    }

    // --- REST API ---

    if (req.method === "GET" && pathname === "/api/health") {
      return json({ ok: true })
    }

    if (req.method === "GET" && pathname === "/api/sessions") {
      return json(listSessions())
    }

    if (req.method === "GET" && pathname.startsWith("/api/sessions/") && pathname.endsWith("/messages")) {
      const id = pathname.slice("/api/sessions/".length, -"/messages".length)
      try {
        getSession(id)
      } catch {
        return json({ error: "Session not found" }, 404)
      }
      const { messages, parts } = loadMessages(id)
      return json(dbToTuiMessages(messages, parts))
    }

    if (req.method === "POST" && pathname === "/api/sessions") {
      const session = createSession()
      return json({ sessionId: session.id })
    }

    if (req.method === "POST" && pathname === "/api/prompt") {
      const body = (await req.json()) as {
        sessionId?: string
        text: string
        images?: { mime: string; data: string }[]
      }

      if (body.sessionId) {
        prompt({
          sessionId: body.sessionId,
          parts: [{ type: "text", text: body.text }],
          images: body.images,
          model: getModelOpt(),
          agent,
        }).catch(() => {})
        return json({ sessionId: body.sessionId })
      }

      const sessionId = await new Promise<string>((resolve) => {
        bus.once("session-created", ({ sessionId }) => resolve(sessionId))
        prompt({
          parts: [{ type: "text", text: body.text }],
          images: body.images,
          model: getModelOpt(),
          agent,
        }).catch(() => {})
      })
      return json({ sessionId })
    }

    if (req.method === "POST" && pathname === "/api/cancel") {
      const body = (await req.json()) as { sessionId: string }
      cancel(body.sessionId)
      return json({ ok: true })
    }

    if (req.method === "POST" && pathname === "/api/model") {
      const body = (await req.json()) as { model: string | null }
      modelOverride = body.model || null
      return json({ model: modelOverride ?? loadConfig().main_model })
    }

    if (req.method === "GET" && pathname === "/api/model") {
      return json({ model: modelOverride ?? loadConfig().main_model })
    }

    if (req.method === "POST" && pathname === "/api/permission") {
      const body = (await req.json()) as {
        sessionId: string
        requestId: string
        action: Reply
        correction?: string
      }
      respondPermission({
        requestId: body.requestId,
        reply: body.action,
        message: body.correction,
      })
      return json({ ok: true })
    }

    if (req.method === "GET" && pathname === "/api/profiles") {
      const ids = listProfiles()
      const profiles = ids.map((id) => {
        const def = resolveProfile(id)
        const { name, description } = readPromptFile(def)
        return { id, name: name ?? def.name, description, tools: def.tools, skills: def.skills }
      })
      return json(profiles)
    }

    if (req.method === "GET" && pathname === "/api/models") {
      const config = loadConfig()
      return json({ models: config.models, mainModel: config.main_model })
    }

    if (req.method === "GET" && pathname === "/api/config") {
      const config = loadConfig()
      return json({
        mainModel: config.main_model,
        contextWindow: config.context_window,
        maxSteps: config.max_steps,
      })
    }

    // --- Static files ---

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const file = Bun.file(new URL("public/index.html", import.meta.url).pathname)
      if (await file.exists()) {
        return new Response(file, { headers: cors({ "Content-Type": "text/html" }) })
      }
      return new Response("Frontend not found", { status: 404, headers: cors() })
    }

    if (req.method === "GET" && pathname.startsWith("/public/")) {
      const file = Bun.file(new URL(pathname.slice(1), import.meta.url).pathname)
      if (await file.exists()) {
        const ext = pathname.split(".").pop()
        const contentType: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          map: "application/json",
        }
        const ct = ext ? contentType[ext] : undefined
        const headers = cors(ct ? { "Content-Type": ct } : undefined)
        return new Response(file, { headers })
      }
    }

    return notFound()
  }
}

export async function startWebServer() {
  const profile = resolveProfile()
  const { content } = readPromptFile(profile)
  const agent = agentFromProfile(profile, content)

  await bootstrap({ profileTools: profile.tools, boundSkills: profile.skills })

  const port = Number(process.env.QUARK_WEB_PORT) || 3000
  const handleRequest = createRequestHandler(agent)

  const server = Bun.serve<WSData>({
    port,
    hostname: "0.0.0.0",
    fetch(req, server) {
      // WebSocket upgrade MUST be synchronous — cannot be behind async
      const url = new URL(req.url)
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, { data: { handlers: new Map() } as WSData })
        if (upgraded) return undefined as unknown as Response
        return json({ error: "WebSocket upgrade failed" }, 400)
      }
      return handleRequest(req, server)
    },
    websocket: {
      open(ws) {
        const handlers = (ws.data as WSData).handlers
        for (const event of ALL_EVENTS) {
          const handler = (data: unknown) => {
            try {
              ws.send(JSON.stringify({ event, data }))
            } catch {}
          }
          handlers.set(event, handler)
          bus.on(event, handler as any)
        }
      },
      message(ws, raw) {
        try {
          const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw))
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ event: "pong" }))
          }
        } catch {}
      },
      close(ws) {
        const handlers = (ws.data as WSData).handlers
        for (const [event, handler] of handlers) {
          bus.off(event, handler as any)
        }
        handlers.clear()
      },
    },
  })

  console.log(`Quark web server listening on http://0.0.0.0:${server.port}`)
  return server
}
