import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useRunnerSessionRoot } from "../../packages/quark/src/session-root"
import { createJsonlSessionStore, createSession, defaultSessionStore } from "../../packages/runner/src/session/session"
import { getSessionStorageRoot, setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"

test("CLI session store uses the REST runner namespace for creation and resumption", () => {
  const root = mkdtempSync(join(tmpdir(), "quark-cli-session-root-"))
  try {
    setSessionStorageRoot(root)
    useRunnerSessionRoot()
    expect(getSessionStorageRoot()).toBe(join(root, "runners"))
    const restStore = createJsonlSessionStore(join(root, "runners"))
    const created = createSession(undefined, restStore)
    expect(defaultSessionStore.get(created.id)?.id).toBe(created.id)
    setSessionStorageRoot(root)
    expect(defaultSessionStore.get(created.id)).toBeNull()
    useRunnerSessionRoot()
    expect(defaultSessionStore.get(created.id)?.id).toBe(created.id)
  } finally {
    setSessionStorageRoot(undefined)
    rmSync(root, { recursive: true, force: true })
  }
})
