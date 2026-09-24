import { afterAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createSession } from "../../packages/runner/src/session/session"
import { loadMessages, toModelMessages } from "../../packages/runner/src/session/message"
import { bus } from "../../packages/runner/src/session/events"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { WebBackend } from "../../web/backend"

// Rejections happen before prompt(), so these tests never reach a model and
// need no prompt mock (module mocks leak across Bun test files).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quark-web-send-"))
setSessionStorageRoot(tmpRoot)
ensureStorageRoot()

// Only the fields send()/route() read; skips the heavy create() that touches
// the real home directory.
function backend(): any {
  const instance: any = Object.create(WebBackend.prototype)
  instance.agent = { id: "test", instructions: "", tools: [], skills: [], model: "test/model" }
  instance.agentDef = { id: "test", name: "Test", instructions: "", tools: [], skills: [] }
  instance.modelOverride = null
  instance.thinkingOverride = null
  instance.pendingSkillContext = []
  instance.activatedSkills = new Set()
  instance.catalog = { catalog: { getModel: () => null } }
  return instance
}

function messageRequest(sessionId: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://test/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  })
}

afterAll(() => {
  setSessionStorageRoot(undefined)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("web POST /api/sessions/:id/messages guards", () => {
  test("accepts an image and persists a model-visible image part", async () => {
    const session = createSession()
    const image = { mime: "image/png", data: "iVBORw0KGgo=" }
    const events: Array<{ sessionId: string; images?: typeof image[] }> = []
    const onMessage = (event: { sessionId: string; images?: typeof image[] }) => events.push(event)
    bus.on("user-message", onMessage)
    try {
      const response = await backend().fetch(messageRequest(session.id, JSON.stringify({ text: "see this", images: [image] })))
      expect(response.status).toBe(202)
      expect(events.some((event) => event.sessionId === session.id && JSON.stringify(event.images) === JSON.stringify([image]))).toBe(true)

      const saved = loadMessages(session.id)
      const imagePart = saved.parts.find((part) => part.type === "image")
      expect(imagePart).toBeDefined()
      expect(JSON.parse(imagePart!.data)).toEqual(image)
      const modelMessages = toModelMessages(saved.messages, saved.parts)
      expect(modelMessages.some((message) => message.role === "user" && Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image" && part.image === image.data && part.mimeType === image.mime))).toBe(true)
    } finally {
      bus.off("user-message", onMessage)
    }
  })

  test("rejects malformed JSON with 400", async () => {
    const session = createSession()
    const response = await backend().fetch(messageRequest(session.id, "{not json"))
    expect(response.status).toBe(400)
  })

  test("rejects missing text with 400", async () => {
    const session = createSession()
    const response = await backend().fetch(messageRequest(session.id, JSON.stringify({})))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Message text is required")
  })

  test("rejects a bad image with 400 naming the index", async () => {
    const session = createSession()
    const body = { text: "x", images: [{ mime: "image/svg+xml", data: "AAAA" }] }
    const response = await backend().fetch(messageRequest(session.id, JSON.stringify(body)))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("images[0]")
  })

  test("rejects an oversized declared body with 413", async () => {
    const session = createSession()
    const response = await backend().fetch(
      messageRequest(session.id, "{", { "content-length": String(20 * 1024 * 1024) }),
    )
    expect(response.status).toBe(413)
  })

  test("invalid input does not consume pending skill context", async () => {
    const session = createSession()
    const instance = backend()
    instance.pendingSkillContext.push("SKILL-CONTEXT")

    const response = await instance.fetch(messageRequest(session.id, "{not json"))
    expect(response.status).toBe(400)
    expect(instance.pendingSkillContext).toEqual(["SKILL-CONTEXT"])
  })
})
