// Session-discovery API tests.
//
// Covers the read-only localhost endpoint the TUI exposes when
// QUARK_API_PORT is set, plus the client wrapper external processes use:
//   - 204 before a session exists (lazy session creation)
//   - 200 { sessionId, pid } once the host reports a current session
//   - 404/405 for anything that is not a plain GET on the one path
//   - stop() actually closes the server

import { afterAll, describe, expect, test } from "bun:test"
import {
  SESSION_API_PATH,
  fetchQuarkSession,
  startSessionApi,
  type SessionApiServer,
} from "../../packages/quark/src/session-api"

const servers: SessionApiServer[] = []

function start(getSessionId: () => string | null): SessionApiServer {
  const server = startSessionApi({ port: 0, getSessionId }) // 0 = OS-assigned port
  servers.push(server)
  return server
}

afterAll(async () => {
  for (const server of servers) {
    try {
      await server.stop()
    } catch {
      // Already stopped by its test — nothing to clean up.
    }
  }
})

const url = (server: SessionApiServer) => `http://127.0.0.1:${server.port}${SESSION_API_PATH}`

describe("session-discovery server", () => {
  test("204 with no body before a session exists", async () => {
    const server = start(() => null)
    const res = await fetch(url(server))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
  })

  test("200 with sessionId and pid once a session is current", async () => {
    let current: string | null = null
    const server = start(() => current)
    current = "abc123" // session created after the server started
    const res = await fetch(url(server))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(await res.json()).toEqual({ sessionId: "abc123", pid: process.pid })
  })

  test("reflects session switches per request (no cached value)", async () => {
    let current: string | null = "first"
    const server = start(() => current)
    expect((await (await fetch(url(server))).json()).sessionId).toBe("first")
    current = "second" // user switched / branched to another session
    expect((await (await fetch(url(server))).json()).sessionId).toBe("second")
    current = null // worktree switch resets to no session
    expect((await fetch(url(server))).status).toBe(204)
  })

  test("404 for unknown paths", async () => {
    const server = start(() => "abc123")
    const res = await fetch(`http://127.0.0.1:${server.port}/api/other`)
    expect(res.status).toBe(404)
  })

  test("405 for non-GET methods", async () => {
    const server = start(() => "abc123")
    const res = await fetch(url(server), { method: "POST" })
    expect(res.status).toBe(405)
  })

  test("stop() closes the server", async () => {
    const server = start(() => "abc123")
    const target = url(server)
    expect((await fetch(target)).status).toBe(200)
    await server.stop()
    await expect(fetch(target)).rejects.toThrow()
  })
})

describe("fetchQuarkSession client wrapper", () => {
  test("resolves session info on 200", async () => {
    const server = start(() => "abc123")
    expect(await fetchQuarkSession(server.port)).toEqual({ sessionId: "abc123", pid: process.pid })
  })

  test("resolves null on 204 (no session yet)", async () => {
    const server = start(() => null)
    expect(await fetchQuarkSession(server.port)).toBeNull()
  })

  test("throws on connection refused (Quark not running)", async () => {
    const server = start(() => "abc123")
    const port = server.port
    await server.stop()
    await expect(fetchQuarkSession(port)).rejects.toThrow()
  })

  test("throws on a malformed payload", async () => {
    // A server that answers the right path with the wrong shape.
    const rogue = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(JSON.stringify({ sessionId: "abc" }), {
        headers: { "content-type": "application/json" },
      }),
    })
    try {
      await expect(fetchQuarkSession(rogue.port)).rejects.toThrow("Malformed")
    } finally {
      await rogue.stop(true)
    }
  })
})
