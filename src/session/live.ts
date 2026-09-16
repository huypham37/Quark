// Local, read-only live session observer.

import { createConnection, createServer, type Socket } from "node:net"
import { chmodSync, existsSync, rmSync } from "node:fs"
import { getLiveSessionSocketPath } from "../storage/session-path"
import { bus, type BusEventName, type BusEvents } from "./events"
import { formatArgs } from "../debug/format-tool-args"

type LiveEvent = { event: BusEventName; data: BusEvents[BusEventName] }

const observed = new Map<string, () => void>()
const eventNames: BusEventName[] = [
  "user-message", "assistant-message-start", "text-start", "text-delta", "text-end",
  "tool-start", "tool-input", "tool-running", "tool-end", "step-start", "step-finish",
  "assistant-message-end", "loop-start", "loop-end", "retry", "error",
  "subagent-tool-start", "subagent-tool-input", "subagent-tool-running", "subagent-tool-end",
  "subagent-done", "subagent-error",
]

/** Start a local socket that mirrors events for one session. Safe to call repeatedly. */
export function startLiveSessionServer(sessionId: string): () => void {
  const existing = observed.get(sessionId)
  if (existing) return existing

  const socketPath = getLiveSessionSocketPath(sessionId)
  const clients = new Set<Socket>()
  let ownsSocket = false
  let stopped = false

  const server = createServer((socket) => {
    clients.add(socket)
    socket.on("close", () => clients.delete(socket))
    socket.write(`${JSON.stringify({ event: "ready", data: { sessionId } })}\n`)
  })

  const send = (event: BusEventName, data: BusEvents[BusEventName]) => {
    if ((data as { sessionId?: string }).sessionId !== sessionId) return
    const line = `${JSON.stringify({ event, data }, errorReplacer)}\n`
    for (const client of clients) {
      if (!client.destroyed) client.write(line)
    }
  }

  const listeners = eventNames.map((event) => {
    const listener = (data: BusEvents[typeof event]) => send(event, data)
    bus.on(event, listener)
    return () => bus.off(event, listener)
  })

  const stop = () => {
    if (stopped) return
    stopped = true
    for (const listener of listeners) listener()
    for (const client of clients) client.destroy()
    if (server.listening) server.close()
    if (ownsSocket) rmSync(socketPath, { force: true })
    observed.delete(sessionId)
  }

  observed.set(sessionId, stop)
  server.on("error", () => {
    // Another live Quark process may already own this session socket.
  })
  server.listen(socketPath, () => {
    ownsSocket = true
    chmodSync(socketPath, 0o600)
  })
  process.once("exit", stop)

  return stop
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
