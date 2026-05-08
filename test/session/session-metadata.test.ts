import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot, replaySessionFile } from "../../src/storage/session-jsonl"
import { createSession, getSession, updateSession } from "../../src/session/session"

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "quark-test-session-meta-"))
  setSessionStorageRoot(tmpDir)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("session task metadata", () => {
  test("new sessions include task-first metadata fields", () => {
    const session = createSession()

    expect(session.taskId).toBeNull()
    expect(session.summary).toBeNull()
    expect(session.parentSummary).toBeNull()
    expect(session.filesModified).toBeNull()
  })

  test("session updates persist through meta.json and JSONL replay", () => {
    const session = createSession()

    updateSession(session.id, {
      taskId: "task_123",
      summary: "Implemented storage",
      parentSummary: "Parent summary",
      filesModified: ["src/session/session.ts"],
    })

    const meta = getSession(session.id)
    expect(meta.taskId).toBe("task_123")
    expect(meta.summary).toBe("Implemented storage")
    expect(meta.parentSummary).toBe("Parent summary")
    expect(meta.filesModified).toEqual(["src/session/session.ts"])

    const replayed = replaySessionFile(session.id).session
    expect(replayed?.taskId).toBe("task_123")
    expect(replayed?.summary).toBe("Implemented storage")
    expect(replayed?.parentSummary).toBe("Parent summary")
    expect(replayed?.filesModified).toEqual(["src/session/session.ts"])
  })
})
