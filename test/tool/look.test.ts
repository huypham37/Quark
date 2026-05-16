// Tests for the look tool
//
// Verifies:
// - Valid image file → injected as synthetic user message, returns success
// - Non-existent file → error
// - Directory → error
// - Unsupported extension → error
// - Image data is correctly base64-encoded and attached to session

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { lookTool } from "../../src/tool/look"
import { loadMessages } from "../../src/session/message"
import { createSession } from "../../src/session/session"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"

let tmpDir: string
let sessionId: string

// Minimal valid 1x1 white PNG (67 bytes)
const MINI_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
)

function ctx() {
  return {
    sessionId,
    messageId: "msg_1",
    callId: "call_1",
    abort: new AbortController().signal,
    ask: async () => {},
  }
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-look-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
  sessionId = createSession().id
})

afterEach(() => {
  // Clean up test images from tmpDir (keep session dirs intact)
  const { readdirSync } = require("fs")
  for (const entry of readdirSync(tmpDir)) {
    // Only delete test image files, not session directories
    if (entry.endsWith(".png") || entry.endsWith(".jpg") || entry.endsWith(".txt")) {
      try { rmSync(join(tmpDir, entry), { force: true }) } catch {}
    }
  }
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("look tool", () => {
  test("rejects non-existent file", async () => {
    const result = await lookTool.execute(
      { path: "/tmp/nonexistent_image_xyz.png" },
      ctx(),
    )
    expect(result.metadata.error).toBe("not_found")
  })

  test("rejects directories", async () => {
    const result = await lookTool.execute({ path: "/tmp" }, ctx())
    expect(result.metadata.error).toBe("is_directory")
  })

  test("rejects unsupported extensions", async () => {
    const txtPath = join(tmpDir, "notes.txt")
    writeFileSync(txtPath, "hello")
    const result = await lookTool.execute({ path: txtPath }, ctx())
    expect(result.metadata.error).toBe("unsupported_type")
  })

  test("reads a PNG, encodes to base64, and injects synthetic user message", async () => {
    const imgPath = join(tmpDir, "test.png")
    writeFileSync(imgPath, MINI_PNG)

    const result = await lookTool.execute({ path: imgPath }, ctx())

    // Output is plain text
    expect(result.title).toContain("Look")
    expect(result.output).toContain("✓ Looked at test.png")
    expect(result.output).toContain("image/png")
    expect(result.output).toMatch(/\d+B\)/) // file size in output
    expect(result.metadata.mediaType).toBe("image/png")

    // Verify synthetic user message was saved to the session
    const { messages, parts } = loadMessages(sessionId)
    const userMessages = messages.filter((m) => m.role === "user")
    expect(userMessages.length).toBe(1)

    const userParts = parts.filter(
      (p) => p.messageId === userMessages[0]!.id,
    )
    const imagePart = userParts.find((p) => p.type === "image")
    expect(imagePart).toBeDefined()

    const data = JSON.parse(imagePart!.data)
    expect(data.mime).toBe("image/png")
    // Verify the base64 data is non-empty (it's the image content)
    expect(data.data).toBeString()
    expect(data.data.length).toBeGreaterThan(50)
    // Also verify the text part on the synthetic user message
    const textPart = userParts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(JSON.parse(textPart!.data).text).toContain("[Image: test.png]")
  })

  test("handles JPEG files", async () => {
    const imgPath = join(tmpDir, "photo.jpg")
    // Minimal valid JPEG (very small — just a marker)
    const minimalJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
      0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
      0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
      0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
      0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
      0x32, 0xff, 0xd9,
    ])
    writeFileSync(imgPath, minimalJpeg)

    const result = await lookTool.execute({ path: imgPath }, ctx())

    expect(result.output).toContain("photo.jpg")
    expect(result.output).toContain("image/jpeg")
    expect(result.metadata.mediaType).toBe("image/jpeg")
  })
})
