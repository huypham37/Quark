import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSession, updateSession } from "../../src/session/session"
import {
  addPart,
  createAssistantMessage,
  finishMessage,
  saveUserMessage,
} from "../../src/session/message"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { exportSessionToMarkdown } from "../../src/commands/export"

let workspace: string
let storageRoot: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "quark-export-workspace-"))
  storageRoot = mkdtempSync(join(tmpdir(), "quark-export-storage-"))
  setSessionStorageRoot(storageRoot)
})

afterEach(() => {
  setSessionStorageRoot(undefined)
  rmSync(workspace, { recursive: true, force: true })
  rmSync(storageRoot, { recursive: true, force: true })
})

describe("exportSessionToMarkdown", () => {
  test("exports only user and assistant text messages under the session title", () => {
    const session = createSession({ directory: workspace })
    updateSession(session.id, { title: "Conversation Export" })

    saveUserMessage({ sessionId: session.id, text: "Hello Quark" })

    const assistant = createAssistantMessage({ sessionId: session.id })
    addPart({
      messageId: assistant.id,
      sessionId: session.id,
      type: "reasoning",
      data: { text: "hidden thinking" },
    })
    addPart({
      messageId: assistant.id,
      sessionId: session.id,
      type: "text",
      data: { text: "Hello user" },
    })
    addPart({
      messageId: assistant.id,
      sessionId: session.id,
      type: "tool",
      data: {
        tool: "read",
        callId: "call-1",
        status: "completed",
        input: { filePath: "src/app.ts" },
        output: "secret tool output",
      },
    })
    finishMessage(assistant.id, "stop", undefined, session.id)

    const result = exportSessionToMarkdown(session.id, { cwd: workspace })

    expect(result.messageCount).toBe(2)
    expect(result.filePath).toBe(join(workspace, ".quark", "export", "Conversation Export.md"))
    expect(existsSync(result.filePath)).toBe(true)
    expect(readFileSync(result.filePath, "utf-8")).toBe([
      "## User",
      "",
      "Hello Quark",
      "",
      "## Assistant",
      "",
      "Hello user",
      "",
    ].join("\n"))
  })

  test("sanitizes the session title for the markdown filename", () => {
    const session = createSession({ directory: workspace })
    updateSession(session.id, { title: "Fix / Export: History?" })
    saveUserMessage({ sessionId: session.id, text: "Export this" })

    const result = exportSessionToMarkdown(session.id, { cwd: workspace })

    expect(result.filePath).toBe(join(workspace, ".quark", "export", "Fix Export History.md"))
  })
})
