// MCP stdio server whose `tools/call` is slow enough to cancel mid-flight.
//
// Same shape as mcp-echo-server.mjs (initialize / tools/list / tools/call), but
// the call answer is delayed so an ACP `session/cancel` can arrive while the
// tool is in flight. Used by test/acp/cancellation.test.ts to prove the turn
// controller reaches MCP (`callTool`'s abort race).

const tools = [
  {
    name: "slow",
    description: "Reply slowly",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
]

const DELAY_MS = Number(process.env.SLOW_MCP_DELAY_MS ?? 300)

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
process.stdin.on("end", () => process.exit(0))

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
          serverInfo: { name: "slow", version: "1.0.0" },
        },
      })
    case "notifications/initialized":
      return
    case "tools/list":
      return send({ jsonrpc: "2.0", id: message.id, result: { tools } })
    case "tools/call": {
      const args = message.params?.arguments ?? {}
      setTimeout(() => {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: String(args.text ?? "") }] },
        })
      }, DELAY_MS)
      return
    }
    default:
      if (message.id != null) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } })
      }
  }
}
