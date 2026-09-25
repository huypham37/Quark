// Minimal MCP stdio server for the QUA-245 ACP tests.
//
// Speaks just enough of MCP over newline-delimited JSON-RPC for the client in
// `packages/acp/src/mcp.ts`: initialize, tools/list (one `echo` tool) and
// tools/call. Exits when stdin closes so a test can prove the client tears the
// child down. Plain JS on purpose — the ACP module spawns it as an executable.

const tools = [
  {
    name: "echo",
    description: "Echo the given text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
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
          serverInfo: { name: "echo", version: "1.0.0" },
        },
      })
    case "notifications/initialized":
      return
    case "tools/list":
      return send({ jsonrpc: "2.0", id: message.id, result: { tools } })
    case "tools/call": {
      const args = message.params?.arguments ?? {}
      if (message.params?.name === "echo") {
        return send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: String(args.text ?? "") }] },
        })
      }
      return send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: `unknown tool ${message.params?.name}` },
      })
    }
    default:
      if (message.id != null) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } })
      }
  }
}
