import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getSessionIndexPath, setSessionStorageRoot } from "../../src/storage/session-path"
import { ensureStorageRoot, replaySessionFile, scanSessionMetas } from "../../src/storage/session-jsonl"
import { createSession, deleteSession, getSession, listAllSessions, setSessionPinned, updateSession } from "../../src/session/session"

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

describe("session metadata", () => {
  test("new sessions include branch metadata fields", () => {
    const session = createSession()

    expect(session.summary).toBeNull()
    expect(session.parentSummary).toBeNull()
    expect(session.filesModified).toBeNull()
    expect(session.pinned).toBe(false)
  })

  test("session updates persist through meta.json and JSONL replay", () => {
    const session = createSession()

    updateSession(session.id, {
      summary: "Implemented storage",
      parentSummary: "Parent summary",
      filesModified: ["src/session/session.ts"],
    })

    const meta = getSession(session.id)
    expect(meta.summary).toBe("Implemented storage")
    expect(meta.parentSummary).toBe("Parent summary")
    expect(meta.filesModified).toEqual(["src/session/session.ts"])

    const replayed = replaySessionFile(session.id).session
    expect(replayed?.summary).toBe("Implemented storage")
    expect(replayed?.parentSummary).toBe("Parent summary")
    expect(replayed?.filesModified).toEqual(["src/session/session.ts"])
  })

  test("deletes a persisted session", () => {
    const session = createSession()

    deleteSession(session.id)

    expect(() => getSession(session.id)).toThrow(`Session not found: ${session.id}`)
    expect(listAllSessions().some((item) => item.id === session.id)).toBe(false)
  })

  test("pins a session without changing its activity time", () => {
    const session = createSession()

    setSessionPinned(session.id, true)

    expect(getSession(session.id).pinned).toBe(true)
    expect(getSession(session.id).timeUpdated).toBe(session.timeUpdated)
    expect(replaySessionFile(session.id).session?.pinned).toBe(true)
  })

  test("keeps the aggregate index current for create, update, and delete", () => {
    const session = createSession()
    expect(existsSync(getSessionIndexPath())).toBe(true)
    expect(scanSessionMetas().some((item) => item.id === session.id)).toBe(true)

    updateSession(session.id, { title: "Indexed session" })
    expect(scanSessionMetas().find((item) => item.id === session.id)?.title).toBe("Indexed session")

    deleteSession(session.id)
    expect(scanSessionMetas().some((item) => item.id === session.id)).toBe(false)
  })

  test("rebuilds the aggregate index when it is missing or corrupt", () => {
    const session = createSession()
    unlinkSync(getSessionIndexPath())
    expect(scanSessionMetas().some((item) => item.id === session.id)).toBe(true)
    expect(existsSync(getSessionIndexPath())).toBe(true)

    writeFileSync(getSessionIndexPath(), "not json")
    expect(scanSessionMetas().some((item) => item.id === session.id)).toBe(true)
  })
})
