// The supervisor socket: what an orchestrator that cannot know the session id
// connects to. It is addressed by a tag the supervisor chose, and it follows the
// process across session moves.
//
// Every case runs in a child process, because the socket belongs to the process
// that owns the session — the env var it reads is that process's own.

import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

const sessionPathModule = JSON.stringify(`${import.meta.dir}/../../src/storage/session-path.ts`)
const liveModule = JSON.stringify(`${import.meta.dir}/../../src/session/live.ts`)
const eventsModule = JSON.stringify(`${import.meta.dir}/../../src/session/events.ts`)

/**
 * A child Quark-like process that owns a supervisor socket.
 *
 * `QUARK_SESSION_ID` is deleted first: the test runner's own environment must
 * not be mistaken for the child's session. `body` runs after the socket is up.
 */
function spawnChild(tag: string, body: string, options: { sessionId?: string } = {}): Bun.Subprocess<"ignore"> {
  root = mkdtempSync(join(tmpdir(), "quark-live-"))
  const script = `
    import { setSessionStorageRoot } from ${sessionPathModule}
    import { startLiveSupervisor } from ${liveModule}
    import { bus } from ${eventsModule}

    setSessionStorageRoot(process.argv.at(-1))
    delete process.env.QUARK_SESSION_ID
    ${options.sessionId ? `process.env.QUARK_SESSION_ID = ${JSON.stringify(options.sessionId)}` : ""}
    startLiveSupervisor(${JSON.stringify(tag)})
    ${body}
    setTimeout(() => process.exit(0), 5000)
  `
  return Bun.spawn(["bun", "-e", script, root], { stderr: "inherit" })
}

function socketPath(tag: string): string {
  return join(root!, "live", `${tag}.sock`)
}

/**
 * How long a child waits before it moves to another session.
 *
 * Long enough that a client connects first — the client holds one connection
 * open across the move, because events are mirrored live and never replayed.
 */
const moveDelay = 300

test("tells a supervisor which session a resumed run is on", async () => {
  const child = spawnChild("task-1", "", { sessionId: "resumed-id" })

  const frames = await readUntil(socketPath("task-1"), (all) => all.length > 0)

  expect(frames[0]).toEqual({
    event: "ready",
    data: { sessionId: "resumed-id", tag: "task-1" },
  })

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("reports no session before the first prompt, then the id it lands on", async () => {
  // The window this covers is the whole point of a supervisor socket: the child
  // is up, the conversation does not exist yet, and the orchestrator has to be
  // able to connect *now* rather than guess when the id will appear.
  const child = spawnChild(
    "task-2",
    `
    setTimeout(() => {
      process.env.QUARK_SESSION_ID = "created-id"
      bus.emit("session-created", { sessionId: "created-id" })
    }, ${moveDelay})
    `,
  )

  const frames = await readAll(socketPath("task-2"), moveDelay + 400)

  expect(frames[0]).toEqual({ event: "ready", data: { sessionId: null, tag: "task-2" } })
  expect(frames[1]).toEqual({
    event: "active-session",
    data: { sessionId: "created-id" },
  })

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("follows /new on a socket that was opened for the previous session", async () => {
  const child = spawnChild(
    "task-3",
    `
    setTimeout(() => {
      process.env.QUARK_SESSION_ID = "second-id"
      bus.emit("session-reset", { sessionId: "second-id" })
    }, ${moveDelay})
    `,
    { sessionId: "first-id" },
  )

  const frames = await readAll(socketPath("task-3"), moveDelay + 400)

  expect(frames[0].data).toEqual({ sessionId: "first-id", tag: "task-3" })
  expect(frames[1]).toEqual({
    event: "active-session",
    data: { sessionId: "second-id" },
  })

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("a silent move — env changes, no event — is reported on the next frame", async () => {
  // `activateBranch()` moves the process without emitting anything a listener
  // could hook; the env is the only trace it leaves.
  const child = spawnChild(
    "task-4",
    `
    setTimeout(() => {
      process.env.QUARK_SESSION_ID = "branched-id"
      bus.emit("loop-start", { sessionId: "branched-id" })
    }, ${moveDelay})
    `,
    { sessionId: "before-id" },
  )

  const frames = await readAll(socketPath("task-4"), moveDelay + 400)

  expect(frames[0].data).toEqual({ sessionId: "before-id", tag: "task-4" })
  expect(frames[1]).toEqual({
    event: "active-session",
    data: { sessionId: "branched-id" },
  })

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("mirrors activity for the session it is on, and nothing else", async () => {
  const child = spawnChild(
    "task-5",
    `
    // After the socket exists, or nobody is connected to receive it: this
    // socket mirrors live events, it does not replay them.
    setTimeout(() => {
      bus.emit("loop-start", { sessionId: "mine" })
      bus.emit("loop-start", { sessionId: "somebody-else" })
    }, 200)
    `,
    { sessionId: "mine" },
  )

  const frames = await readAll(socketPath("task-5"), 500)

  expect(frames.filter((frame) => frame.event === "loop-start")).toEqual([
    { event: "loop-start", data: { sessionId: "mine" } },
  ])

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("reclaims a socket file left behind by a killed process", async () => {
  root = mkdtempSync(join(tmpdir(), "quark-live-"))
  // A corpse: the path exists and nothing answers on it, which is what every
  // SIGKILLed Quark leaves behind. `existsSync` cannot tell it from a live one.
  mkdirSync(join(root, "live"), { recursive: true })
  writeFileSync(join(root, "live", "task-6.sock"), "")

  const child = spawnChild("task-6", "", { sessionId: "reclaimed-id" })

  const frames = await readUntil(socketPath("task-6"), (all) => all.length > 0)
  expect(frames[0].data).toEqual({ sessionId: "reclaimed-id", tag: "task-6" })

  child.kill()
  expect(await child.exited).not.toBe(0)
})

test("leaves a socket another live process owns alone", async () => {
  const owner = spawnChild("task-7", "", { sessionId: "owner-id" })
  await waitFor(() => existsSync(socketPath("task-7")))

  // A second process on the same tag must not unlink the path the first is
  // serving — the supervisor would lose the socket that is actually live.
  const intruderRoot = root
  const script = `
    import { setSessionStorageRoot } from ${sessionPathModule}
    import { startLiveSupervisor } from ${liveModule}

    setSessionStorageRoot(${JSON.stringify(intruderRoot)})
    delete process.env.QUARK_SESSION_ID
    process.env.QUARK_SESSION_ID = "intruder-id"
    startLiveSupervisor("task-7")
    setTimeout(() => process.exit(0), 5000)
  `
  const intruder = Bun.spawn(["bun", "-e", script], { stderr: "inherit" })

  const frames = await readAll(socketPath("task-7"), 300)
  expect(frames[0].data).toEqual({ sessionId: "owner-id", tag: "task-7" })

  owner.kill()
  intruder.kill()
  expect(await owner.exited).not.toBe(0)
  expect(await intruder.exited).not.toBe(0)
})

test("refuses a tag that is not a single path component", async () => {
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      `
      import { setSessionStorageRoot, getLiveSupervisorSocketPath } from ${sessionPathModule}
      import { startLiveSupervisor } from ${liveModule}

      setSessionStorageRoot(process.argv.at(-1))
      const tags = ["ok-tag", "../escape", "a/b", "", ".", "..", "x".repeat(65)]
      console.log(JSON.stringify(tags.map((tag) => getLiveSupervisorSocketPath(tag))))
      console.log(JSON.stringify(
        ["ok-tag", "../escape", "a/b", ""].map((tag) => startLiveSupervisor(tag) === undefined),
      ))
      process.exit(0)
      `,
      root = mkdtempSync(join(tmpdir(), "quark-live-")),
    ],
    { stderr: "inherit" },
  )

  const output = await new Response(child.stdout).text()
  const [paths, ignored] = output.trim().split("\n").map((line) => JSON.parse(line))

  expect(paths[0]).toBe(join(root, "live", "ok-tag.sock"))
  expect(paths.slice(1)).toEqual([null, null, null, null, null, null])
  expect(ignored).toEqual([false, true, true, true])
  expect(await child.exited).toBe(0)
})

interface Frame {
  event: string
  data: Record<string, unknown>
}

/** Connect, retrying until `done` holds. */
async function readUntil(path: string, done: (frames: Frame[]) => boolean): Promise<Frame[]> {
  let frames: Frame[] = []

  for (let attempt = 0; attempt < 100; attempt++) {
    frames = await collect(path, 60)
    if (done(frames)) return frames
    // No socket yet, or nothing to read on it: wait for the file to appear.
    await Bun.sleep(20)
  }

  return frames
}

/** Connect once and collect whatever arrives. */
async function readAll(path: string, milliseconds: number): Promise<Frame[]> {
  await waitFor(() => existsSync(path))
  return collect(path, milliseconds)
}

async function collect(path: string, milliseconds: number): Promise<Frame[]> {
  if (!existsSync(path)) return []

  const frames: Frame[] = []
  const socket = createConnection(path)
  socket.setEncoding("utf8")
  socket.on("error", () => socket.destroy())

  let buffer = ""
  socket.on("data", (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line) frames.push(JSON.parse(line) as Frame)
      newline = buffer.indexOf("\n")
    }
  })

  for (let waited = 0; waited < milliseconds; waited += 20) await Bun.sleep(20)
  socket.destroy()
  return frames
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("Timed out waiting for the supervisor socket")
}
