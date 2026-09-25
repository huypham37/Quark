// Session-discovery API — read-only localhost HTTP for external processes.
//
// An orchestrator that wants to link its tasks to a Quark session only needs
// the current session ID. No handshake, no write access: one GET endpoint
// reporting whatever the host app (TUI) considers "current".
//
//   GET /api/session/current
//     200 {"sessionId":"abc","pid":1234}   session exists
//     204 No Content                       no session yet (lazy creation)
//
// Started by the app process via QUARK_API_PORT — never by the engine. The
// runner stays side-effect-free; it cannot know which of its many sessions
// is "the current one".
//
// Read-only + localhost-only: no auth needed. If write endpoints (prompt,
// cancel) are ever added, switch to a unix socket so file permissions become
// the access control.

export const SESSION_API_PATH = "/api/session/current"

export interface SessionApiOptions {
  /**
   * Port to bind. `0` lets the OS pick a free port (the actual port is
   * reported on the returned server — used by tests).
   */
  port: number
  /**
   * Bind address. Defaults to `127.0.0.1` — this API must never be exposed
   * outside localhost.
   */
  hostname?: string
  /**
   * Returns the session ID the host considers current, or `null` when no
   * session exists yet. Called per request so the answer always reflects
   * session switches, branches, and worktree changes.
   */
  getSessionId: () => string | null
}

export interface SessionApiServer {
  /** The port actually bound (differs from `options.port` when port was 0). */
  port: number
  /** Stop accepting connections and close active ones. */
  stop: () => Promise<void>
}

/** Information reported about the Quark process owning the current session. */
export interface QuarkSessionInfo {
  sessionId: string
  /** PID of the Quark process (the TUI), useful for liveness checks. */
  pid: number
}

/**
 * Start the session-discovery API.
 *
 * @example
 * ```ts
 * const server = startSessionApi({
 *   port: 47831,
 *   getSessionId: () => currentSession?.id ?? null,
 * })
 * ```
 * @throws When the port cannot be bound (e.g. already in use). Callers
 * should treat this as non-fatal — the app must keep working without it.
 */
export function startSessionApi(options: SessionApiOptions): SessionApiServer {
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch(req) {
      return handleSessionApiRequest(req, options.getSessionId)
    },
  })
  const port = server.port
  // A TCP-bound Bun server always reports its port; only unix-socket servers
  // leave it undefined, and this module never binds a socket path.
  if (port === undefined) throw new Error("Session API server did not report a port")
  return {
    port,
    // `stop(true)` also closes keep-alive connections so tests can shut down
    // deterministically. Awaiting works for both sync and async Bun returns.
    stop: async () => {
      await server.stop(true)
    },
  }
}

function handleSessionApiRequest(req: Request, getSessionId: () => string | null): Response {
  const { pathname } = new URL(req.url)
  if (pathname !== SESSION_API_PATH) {
    return json({ error: "not found" }, 404)
  }
  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405)
  }
  const sessionId = getSessionId()
  if (!sessionId) {
    // 204 keeps the response body-less: "Quark is running, no session yet".
    return new Response(null, { status: 204 })
  }
  return json({ sessionId, pid: process.pid } satisfies QuarkSessionInfo)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Read-only localhost endpoint; letting browser tooling probe it is
      // harmless and simplifies debugging from a dev console.
      "access-control-allow-origin": "*",
    },
  })
}

/**
 * Client wrapper for the session-discovery API.
 *
 * - `200` → the current session info
 * - `204` → `null` (Quark is running but no session exists yet)
 * - connection refused / unexpected status → throws, so callers can
 *   distinguish "Quark not running" from "no session yet"
 *
 * @example
 * ```ts
 * const info = await fetchQuarkSession(47831) // { sessionId, pid } | null
 * ```
 */
export async function fetchQuarkSession(
  port: number,
  hostname: string = "127.0.0.1",
): Promise<QuarkSessionInfo | null> {
  const res = await fetch(`http://${hostname}:${port}${SESSION_API_PATH}`)
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`Quark session API returned HTTP ${res.status}`)
  const body: unknown = await res.json()
  if (
    typeof body !== "object" || body === null
    || typeof (body as QuarkSessionInfo).sessionId !== "string"
    || typeof (body as QuarkSessionInfo).pid !== "number"
  ) {
    throw new Error("Malformed response from Quark session API")
  }
  return body as QuarkSessionInfo
}
