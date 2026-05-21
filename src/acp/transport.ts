// JSON-RPC 2.0 transport over NDJSON (newline-delimited JSON)
//
// Reads JSON-RPC messages from an input stream, writes responses/notifications
// to an output stream. Each message is a single line of JSON.
//
// Supports bidirectional communication: the agent can call client methods
// (e.g. session/request_permission) and await the response.

import type { JsonRpcRequest, JsonRpcNotification, RequestId } from "./schema"
import * as s from "./schema"

export type IncomingMessage =
  | { kind: "request"; data: JsonRpcRequest }
  | { kind: "notification"; data: JsonRpcNotification }
  | { kind: "response"; id: RequestId; result?: unknown; error?: s.JsonRpcError }
  | { kind: "error"; error: string }

export type OutgoingMessage =
  | { jsonrpc: "2.0"; id: RequestId; result: unknown }
  | { jsonrpc: "2.0"; id: RequestId; error: s.JsonRpcError }
  | { jsonrpc: "2.0"; method: string; params?: unknown }

/** Unique request ID generator — monotonic counter per transport instance */
let nextId = 1

export interface AcpTransport {
  [Symbol.asyncIterator](): AsyncIterator<IncomingMessage>
  /** Send a JSON-RPC response or notification (no response expected) */
  send(msg: OutgoingMessage): void
  /** Call a client method and wait for the response */
  call(method: string, params: unknown): Promise<unknown>
}

function parseLine(line: string): IncomingMessage {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(line)
  } catch {
    return { kind: "error", error: `Failed to parse JSON: ${line.slice(0, 200)}` }
  }

  if (typeof raw !== "object" || raw === null) {
    return { kind: "error", error: "Message is not a JSON object" }
  }

  if (raw.jsonrpc !== "2.0") {
    return { kind: "error", error: `Invalid or missing jsonrpc version: ${String(raw.jsonrpc)}` }
  }

  // Response (has id but no method)
  if ("id" in raw && !("method" in raw)) {
    if ("error" in raw) {
      const parsed = s.JsonRpcError.safeParse(raw.error)
      return {
        kind: "response",
        id: raw.id as RequestId,
        error: parsed.success ? parsed.data : { code: s.ErrorCodes.InternalError, message: "Invalid error object" },
      }
    }
    return { kind: "response", id: raw.id as RequestId, result: raw.result }
  }

  // Request (has both method and id)
  if ("method" in raw && "id" in raw) {
    const parsed = s.JsonRpcRequest.safeParse(raw)
    if (!parsed.success) {
      return { kind: "error", error: `Invalid request: ${parsed.error.message}` }
    }
    return { kind: "request", data: parsed.data }
  }

  // Notification (has method, no id)
  if ("method" in raw) {
    const parsed = s.JsonRpcNotification.safeParse(raw)
    if (!parsed.success) {
      return { kind: "error", error: `Invalid notification: ${parsed.error.message}` }
    }
    return { kind: "notification", data: parsed.data }
  }

  return { kind: "error", error: "Message must have a method field" }
}

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

export function createTransport(
  input: ReadableStream<Uint8Array>,
  output: WritableStream<Uint8Array>,
): AcpTransport {
  const encoder = new TextEncoder()
  const writer = output.getWriter()
  const pending = new Map<RequestId, PendingCall>()

  function writeLine(msg: Record<string, unknown>): void {
    writer.write(encoder.encode(JSON.stringify(msg) + "\n"))
  }

  return {
    async *[Symbol.asyncIterator]() {
      const reader = input.getReader()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return

          buffer += new TextDecoder().decode(value)

          while (true) {
            const idx = buffer.indexOf("\n")
            if (idx === -1) break

            const line = buffer.slice(0, idx).trim()
            buffer = buffer.slice(idx + 1)

            if (line.length === 0) continue
            const msg = parseLine(line)

            // Route responses to pending calls
            if (msg.kind === "response") {
              const call = pending.get(msg.id)
              if (call) {
                pending.delete(msg.id)
                if (msg.error) {
                  call.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
                } else {
                  call.resolve(msg.result)
                }
              }
              continue
            }

            yield msg
          }
        }
      } finally {
        reader.releaseLock()
        // Reject all pending calls on close
        for (const [, call] of pending) {
          call.reject(new Error("Transport closed"))
        }
        pending.clear()
      }
    },

    send(msg: OutgoingMessage): void {
      writeLine(msg)
    },

    call(method: string, params: unknown): Promise<unknown> {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        writeLine({ jsonrpc: "2.0", id, method, params })
      })
    },
  }
}
