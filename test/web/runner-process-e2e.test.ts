import { test, expect } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fixture = join(import.meta.dir, "fixtures", "runner-e2e-server.ts")

async function start(root: string): Promise<{ base: string; child: ChildProcessWithoutNullStreams }> {
  const child = spawn(process.execPath, ["run", fixture], {
    env: { ...process.env, QUARK_CONFIG_DIR: join(root, "config"), QUARK_E2E_SESSION_ROOT: join(root, "sessions") },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stderr.on("data", (data) => { stderr += data.toString() })
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server startup timeout: ${stderr}`)), 15000)
    child.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${stderr}`)) })
    child.stdout.on("data", (data) => {
      stdout += data.toString()
      const line = stdout.split("\n").find((line) => line.includes('"port"'))
      if (!line) return
      clearTimeout(timeout)
      resolve(JSON.parse(line).port)
    })
  })
  return { base: `http://127.0.0.1:${port}`, child }
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.kill("SIGTERM")
  })
}

async function post(base: string, route: string, body?: unknown) {
  return fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for completed turn")
}

function texts(view: any): string[] {
  return view.messages.flatMap((message: any) => message.parts ?? [])
    .filter((part: any) => part.type === "text").map((part: any) => part.text)
}

test("real HTTP + process restart: new runner continues persisted history after delete", async () => {
  const root = mkdtempSync(join(tmpdir(), "quark-runner-process-e2e-"))
  let current: ChildProcessWithoutNullStreams | undefined
  try {
    let server = await start(root)
    current = server.child
    const first = await (await post(server.base, "/api/runners")).json() as { runnerId: string }
    const send = await post(server.base, `/api/runners/${first.runnerId}/session/prompt`, { text: "before restart" })
    expect(send.status).toBe(202)
    const { sessionId } = await send.json() as { sessionId: string }
    const read = (base: string, runnerId: string) => fetch(`${base}/api/runners/${runnerId}/sessions/${sessionId}`)
    await waitUntil(async () => {
      const response = await read(server.base, first.runnerId)
      const view = await response.json()
      return !view.session.running && texts(view).includes("before restart")
    })
    expect((await fetch(`${server.base}/api/runners/${first.runnerId}`, { method: "DELETE" })).status).toBe(200)
    await stop(server.child)
    current = undefined

    server = await start(root)
    current = server.child
    const second = await (await post(server.base, "/api/runners")).json() as { runnerId: string }
    expect(second.runnerId).not.toBe(first.runnerId)
    const prior = await read(server.base, second.runnerId)
    expect(prior.status).toBe(200)
    expect(texts(await prior.json())).toContain("before restart")
    const resumed = await post(server.base, `/api/runners/${second.runnerId}/session/prompt`, { sessionId, text: "after restart" })
    expect(resumed.status).toBe(202)
    await waitUntil(async () => {
      const view = await (await read(server.base, second.runnerId)).json()
      return !view.session.running && texts(view).includes("after restart")
    })
    const view = await (await read(server.base, second.runnerId)).json()
    expect(texts(view)).toEqual(["before restart", "after restart"])
  } finally {
    if (current) await stop(current)
    rmSync(root, { recursive: true, force: true })
  }
}, 40000)
