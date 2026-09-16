import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

test("streams tool events to a local observer", async () => {
  root = mkdtempSync(join(tmpdir(), "quark-live-"))
  const socketPath = join(root, "session", "live.sock")
  const child = Bun.spawn(["bun", "-e", childScript, root])

  await waitFor(() => existsSync(socketPath))
  const socket = createConnection(socketPath)
  socket.setEncoding("utf8")
  let output = ""
  socket.on("data", (chunk: string) => { output += chunk })

  await waitFor(() => output.includes('"event":"tool-input"'))
  expect(output).toContain('"cmd":"pwd"')
  socket.destroy()
  expect(await child.exited).toBe(0)
})

const childScript = `
  import { mkdirSync } from "node:fs"
  import { join } from "node:path"
  import { setSessionStorageRoot } from ${JSON.stringify(`${import.meta.dir}/../../src/storage/session-path.ts`)}
  import { startLiveSessionServer } from ${JSON.stringify(`${import.meta.dir}/../../src/session/live.ts`)}
  import { bus } from ${JSON.stringify(`${import.meta.dir}/../../src/session/events.ts`)}

  const root = process.argv.at(-1)
  setSessionStorageRoot(root)
  mkdirSync(join(root, "session"), { recursive: true })
  const stop = startLiveSessionServer("session")
  setTimeout(() => bus.emit("tool-input", {
    sessionId: "session", messageId: "message", partId: "part", tool: "shell", callId: "call", input: { cmd: "pwd" },
  }), 100)
  setTimeout(() => { stop(); process.exit(0) }, 300)
`

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for live session event")
}
