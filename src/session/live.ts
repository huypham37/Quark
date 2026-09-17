// Local, read-only live session observer.
//
// Two sockets, one implementation:
//
//   session/<id>/live.sock — mirrors one session. `quark --watch <id>`.
//   live/<tag>.sock        — follows the *process*, for a supervisor that cannot
//                            know the id yet. See `startLiveSupervisor`.

import { createConnection, createServer, type Socket } from "node:net"
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs"
import {
  getLiveSessionSocketPath,
  getLiveSupervisorDir,
  getLiveSupervisorSocketPath,
} from "../storage/session-path"
import { bus, type BusEventName, type BusEvents } from "./events"
import { formatArgs } from "../debug/format-tool-args"

type LiveEvent = { event: BusEventName; data: BusEvents[BusEventName] }

const observed = new Map<string, () => void>()

/** Bus events mirrored to clients. */
const eventNames: BusEventName[] = [
  "user-message", "assistant-message-start", "text-start", "text-delta", "text-end",
  "tool-start", "tool-input", "tool-running", "tool-end", "step-start", "step-finish",
  "assistant-message-end", "loop-start", "loop-end", "retry", "error",
  "subagent-tool-start", "subagent-tool-input", "subagent-tool-running", "subagent-tool-end",
  "subagent-done", "subagent-error",
]

/**
 * Every event that can mean the process is now on a different session.
 *
 * `session-reset` is the odd one: `/new` emits the *new* id, while a worktree
 * switch emits `null` ("no session here"). Clients treat `null` as "keep the id
 * you have" — the conversation that just ended is still the one worth resuming.
 */
const sessionEvents: BusEventName[] = ["session-created", "session-switch", "session-reset"]

/** Which session a socket mirrors. */
interface SessionTracker {
  current(): string | null

  /**
   * Adopt the session the process is actually on, if it moved. Returns whether
   * anything changed.
   *
   * `hint` is the id a session event carried — taken over the environment,
   * because an event is authoritative about the move it announces and does not
   * depend on the order in which the emitting site happens to set the env.
   *
   * A `null` hint is ignored rather than adopted: `/new` and a worktree switch
   * both briefly say "no session", and the id of the conversation that just
   * ended is still the one worth resuming.
   *
   * For a per-session socket this is always `false` — `--watch <id>` mirrors the
   * session it was asked for, and never drifts to another.
   */
  reconcile(hint?: string | null): boolean
}

/**
 * Follow whatever session the process is on.
 *
 * `QUARK_SESSION_ID` is the ground truth, and it is already maintained at every
 * transition site in the TUI — resume, lazy creation, `/new`, worktree switch,
 * branch, session picker. The bus events are only how we learn *when* to look,
 * and reading the env as well is what catches the transitions that emit nothing
 * (a branch activated through `activateBranch()`, for instance: the env moves, no
 * event fires, and a listener tracking `session-switch` alone would go stale).
 */
function followingSession(): SessionTracker {
  let current = process.env.QUARK_SESSION_ID?.trim() || null

  return {
    current: () => current,
    reconcile(hint) {
      const next = hint?.trim() || process.env.QUARK_SESSION_ID?.trim() || null
      if (!next || next === current) return false
      current = next
      return true
    },
  }
}

function fixedSession(sessionId: string): SessionTracker {
  return { current: () => sessionId, reconcile: () => false }
}

interface SocketOptions {
  /** Path this server owns. */
  path: string
  /** Directory to create, `0700`, before listening — when it is not a session's own. */
  directory?: string
  sessions: SessionTracker
  /** Fields added to the ready frame, so a client can tell which socket answered. */
  ready?: Record<string, unknown>
}

/** Start a local socket that mirrors events for one session. Safe to call repeatedly. */
export function startLiveSessionServer(sessionId: string): () => void {
  return serve(sessionId, {
    path: getLiveSessionSocketPath(sessionId),
    sessions: fixedSession(sessionId),
  })
}

/**
 * Start the socket a supervisor connects to, addressed by a tag it chose.
 *
 * The id is the thing a supervisor cannot get any other way: the terminal title
 * carries the session's *name*, `session/index.json` cannot tell two sessions in
 * one directory apart, and the id in a child's environment is unreadable from
 * outside. `--watch <id>` cannot help either — it is addressed *by* the id.
 *
 * So the tag is the supervisor's, and the socket follows the process across
 * session moves: connect once, the moment the child spawns, and be told the id
 * whenever there is one. The `ready` frame carries `sessionId: null` until the
 * first prompt creates a session.
 *
 * Returns `undefined` for a tag that is not a usable path component; the caller
 * keeps running without a socket, exactly as it would with the tag unset.
 */
export function startLiveSupervisor(tag: string): (() => void) | undefined {
  const path = getLiveSupervisorSocketPath(tag)
  if (!path) return undefined

  return serve(`tag:${tag}`, {
    path,
    directory: getLiveSupervisorDir(),
    sessions: followingSession(),
    ready: { tag },
  })
}

function serve(key: string, options: SocketOptions): () => void {
  const existing = observed.get(key)
  if (existing) return existing

  const clients = new Set<Socket>()
  let ownsSocket = false
  let stopped = false

  const line = (event: string, data: unknown): string =>
    `${JSON.stringify({ event, data }, errorReplacer)}\n`

  const broadcast = (event: string, data: unknown): void => {
    const payload = line(event, data)
    for (const client of clients) {
      if (!client.destroyed) client.write(payload)
    }
  }

  const server = createServer((client) => {
    clients.add(client)
    // A supervisor that exits mid-frame must not take this process down through
    // an unhandled EPIPE.
    client.on("error", () => clients.delete(client))
    client.on("close", () => clients.delete(client))

    // Asked first, so the handshake already reflects a move that happened while
    // this client was connecting.
    options.sessions.reconcile()
    client.write(line("ready", { sessionId: options.sessions.current(), ...options.ready }))
  })

  const announce = (hint?: string | null): void => {
    if (options.sessions.reconcile(hint)) {
      broadcast("active-session", { sessionId: options.sessions.current() })
    }
  }

  const listeners = [...eventNames, ...sessionEvents].map((event) => {
    const listener = (data: BusEvents[typeof event]) => {
      const id = (data as { sessionId?: string | null }).sessionId ?? null
      // Only session events announce a move; the others are an invitation to
      // re-read the environment, which is how a silent transition is noticed.
      announce(sessionEvents.includes(event) ? id : undefined)

      if (id !== options.sessions.current()) return
      broadcast(event, data)
    }
    bus.on(event, listener)
    return () => bus.off(event, listener)
  })

  const stop = () => {
    if (stopped) return
    stopped = true
    for (const listener of listeners) listener()
    for (const client of clients) client.destroy()
    if (server.listening) server.close()
    if (ownsSocket) rmSync(options.path, { force: true })
    observed.delete(key)
  }

  observed.set(key, stop)
  server.on("error", () => {
    // Another live Quark process may already own this socket.
  })

  reclaim(options, () => {
    if (stopped) return
    server.listen(options.path, () => {
      // `stop()` can land while the socket is still being created: the file
      // would be owned by nobody and outlive the process.
      if (stopped) {
        server.close()
        rmSync(options.path, { force: true })
        return
      }
      ownsSocket = true
      // Best effort: a chmod that loses a race with a directory being wiped
      // (a supervised run in a scratch directory, say) is not a reason to take
      // the TUI down. The socket still works; the mode is just the umask's.
      try {
        chmodSync(options.path, 0o600)
      } catch {}
    })
  })

  // Clean exits remove their own socket. A SIGKILLed process cannot, and nothing
  // else would: the next process on this path reclaims it.
  process.once("exit", stop)

  return stop
}

/**
 * Listen, first clearing a socket file left behind by a process that was killed.
 *
 * `existsSync` cannot tell a live socket from a corpse — a SIGKILLed process
 * never removes its own, and they accumulate (100+ in one real install).
 * Connecting is the only honest test: a corpse refuses the connection. A live
 * owner is left alone, so two processes cannot fight over one path.
 */
function reclaim(options: SocketOptions, listen: () => void): void {
  if (options.directory) {
    // Best effort, and never fatal: this runs inside a TUI's startup, and a
    // socket is a nice-to-have. With no directory the listen below fails, the
    // error handler swallows it, and the supervisor simply never connects —
    // which is exactly the behaviour of an unsupported tag.
    try {
      mkdirSync(options.directory, { recursive: true, mode: 0o700 })
      chmodSync(options.directory, 0o700)
    } catch {}
  }

  if (!existsSync(options.path)) {
    listen()
    return
  }

  const probe = createConnection(options.path)
  let settled = false
  const finish = (isLive: boolean) => {
    if (settled) return
    settled = true
    probe.destroy()
    if (!isLive) rmSync(options.path, { force: true })
    listen()
  }

  probe.on("connect", () => finish(true))
  probe.on("error", () => finish(false))
}

/** Connect to a local session and print its future activity until it ends. */
export async function watchLiveSession(sessionId: string): Promise<void> {
  const socketPath = getLiveSessionSocketPath(sessionId)
  for (let i = 0; i < 20 && !existsSync(socketPath); i++) {
    await Bun.sleep(50)
  }
  if (!existsSync(socketPath)) {
    throw new Error(`Session ${sessionId} is not running locally`)
  }

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    let connected = false

    socket.setEncoding("utf8")
    socket.on("connect", () => {
      connected = true
      process.stdout.write(`Watching ${sessionId} (read-only)\n`)
    })
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line) renderLiveEvent(JSON.parse(line) as LiveEvent)
        newline = buffer.indexOf("\n")
      }
    })
    socket.on("error", (error) => {
      if (connected) {
        process.stderr.write(`\nLive session ended: ${error.message}\n`)
      } else if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`Session ${sessionId} is not running locally`))
      } else {
        reject(error)
      }
    })
    socket.on("close", () => connected && resolve())
  })
}

function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message }
  return value
}

function renderLiveEvent({ event, data }: LiveEvent): void {
  const value = data as Record<string, any>
  switch (event) {
    case "text-delta":
      process.stdout.write(value.delta)
      return
    case "text-end":
      process.stdout.write("\n")
      return
    case "tool-start":
      process.stdout.write(`\n→ ${value.tool}\n`)
      return
    case "tool-input":
      process.stdout.write(`  ${formatArgs(value.input)}\n`)
      return
    case "tool-running":
      process.stdout.write("  running\n")
      return
    case "tool-end":
      process.stdout.write(`  ${value.status}\n`)
      return
    case "subagent-tool-start":
      process.stdout.write(`\n↳ ${value.profile}: ${value.tool}\n`)
      return
    case "subagent-tool-input":
      process.stdout.write(`  ${formatArgs(value.input)}\n`)
      return
    case "subagent-tool-end":
      process.stdout.write(`  ${value.status}\n`)
      return
    case "loop-start":
      process.stdout.write("Agent working…\n")
      return
    case "loop-end":
      process.stdout.write("Agent finished.\n")
      return
    case "error":
      process.stderr.write(`Error: ${value.error?.message ?? value.error}\n`)
      return
  }
}
