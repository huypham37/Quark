// MCP stdio server that ignores SIGTERM (QUA-267).
//
// Proves the ACP teardown SIGKILLs a child that refuses to die: it records its
// pid and every SIGTERM it receives to the file named by STUBBORN_MARKER, then
// keeps running until SIGKILL. It deliberately does NOT exit on stdin end (the
// echo fixture does), so teardown has to use the signal, not EOF.
//
// Plain JS on purpose — the ACP module spawns it as an executable.

import { appendFileSync } from "node:fs"

const marker = process.env.STUBBORN_MARKER
const mark = (text) => {
  if (marker) appendFileSync(marker, text)
}
mark(`pid=${process.pid}\n`)

// Ignore SIGTERM: the client must escalate to SIGKILL.
process.on("SIGTERM", () => mark("SIGTERM\n"))

const tools = [
  {
    name: "stubborn",
    description: "Never exits on SIGTERM",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) handle(JSON.parse(line))
  }
})

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  switch (message.method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "stubborn", version: "1.0.0" },
        },
      })
    case "notifications/initialized":
      return
    case "tools/list":
      return send({ jsonrpc: "2.0", id: message.id, result: { tools } })
    default:
      if (message.id != null) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } })
      }
  }
}
