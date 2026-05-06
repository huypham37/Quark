import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startWebServer } from "../src/web/server"
import type { Server } from "bun"

let server: Server | null = null
let baseUrl = ""

beforeAll(async () => {
  // Use a random port to avoid conflicts
  const origPort = process.env.QUARK_WEB_PORT
  process.env.QUARK_WEB_PORT = "0" // 0 = random port
  server = await startWebServer()
  baseUrl = server.url.toString()
  process.env.QUARK_WEB_PORT = origPort || ""
})

afterAll(() => {
  if (server) server.stop()
})

describe("GET /api/workspace/file", () => {
  test("returns file content for valid path", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file?path=package.json`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty("content")
    expect(data).toHaveProperty("mtime")
    expect(data).toHaveProperty("size")
    expect(typeof data.content).toBe("string")
    expect(data.content.length).toBeGreaterThan(0)
  })

  test("returns 400 for missing path", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file`)
    expect(res.status).toBe(400)
  })

  test("returns 404 for non-existent file", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file?path=nonexistent-xyz.abc`)
    expect(res.status).toBe(404)
  })

  test("returns 403 for path outside workspace", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file?path=../etc/passwd`)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/workspace/file", () => {
  const testPath = "test-desktop-api-temp.txt"

  test("writes file and returns ok", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: testPath, content: "hello test" }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true })
  })

  test("written file is readable", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file?path=${testPath}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toBe("hello test")
  })

  test("returns 400 for missing path", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    })
    expect(res.status).toBe(400)
  })

  test("returns 403 for path outside workspace", async () => {
    const res = await fetch(`${baseUrl}api/workspace/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../outside.txt", content: "x" }),
    })
    expect(res.status).toBe(403)
  })

  afterAll(async () => {
    // Cleanup test file
    try { await Bun.file(testPath).delete() } catch {}
  })
})

describe("GET /api/workspace/tree", () => {
  test("returns file listing", async () => {
    const res = await fetch(`${baseUrl}api/workspace/tree`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty("files")
    expect(Array.isArray(data.files)).toBe(true)
    expect(data.files.length).toBeGreaterThan(0)
    // Should include package.json
    expect(data.files.some((f: string) => f === "package.json" || f.includes("package.json"))).toBe(true)
  })
})

describe("POST /api/prompt with context", () => {
  test("accepts context field", async () => {
    const res = await fetch(`${baseUrl}api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", context: "Active file: src/foo.ts" }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty("sessionId")
  })

  test("works without context field (backward compat)", async () => {
    const res = await fetch(`${baseUrl}api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty("sessionId")
  })
})

describe("Existing endpoints unaffected", () => {
  test("GET /api/health", async () => {
    const res = await fetch(`${baseUrl}api/health`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty("ok", true)
  })

  test("GET /api/sessions", async () => {
    const res = await fetch(`${baseUrl}api/sessions`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })
})
