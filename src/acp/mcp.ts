import { createMCPClient, type MCPClient } from "@ai-sdk/mcp"
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import type { ToolSet } from "ai"
import type { McpServer } from "./schema"

export interface McpClientLike {
  tools(): Promise<Record<string, unknown>>
  close(): Promise<void>
}

export type McpClientFactory = (server: McpServer) => Promise<McpClientLike>

function headers(entries: { name: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(entries.map(({ name, value }) => [name, value]))
}

async function createClient(server: McpServer): Promise<MCPClient> {
  if ("command" in server) {
    // MCP configuration supplements, rather than replaces, the ACP process environment.
    // This is important for credentials and PATH inherited from the editor process.
    const env = {
      ...(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>),
      ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
    }
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: server.command,
        args: server.args,
        env,
      }),
      clientName: "quark",
    })
  }

  return createMCPClient({
    transport: {
      type: server.type,
      url: server.url,
      headers: headers(server.headers),
    },
    clientName: "quark",
  })
}

/** Connections and discovered tools owned by one ACP session. */
export class McpSession {
  private constructor(
    readonly tools: ToolSet,
    private readonly clients: McpClientLike[],
  ) {}

  static async connect(
    servers: McpServer[],
    clientFactory: McpClientFactory = createClient,
  ): Promise<McpSession> {
    const clients: McpClientLike[] = []
    const tools: ToolSet = {}
    const serverNames = new Set<string>()

    try {
      for (const server of servers) {
        if (serverNames.has(server.name)) {
          throw new Error(`Duplicate MCP server name: ${server.name}`)
        }
        serverNames.add(server.name)

        const client = await clientFactory(server)
        clients.push(client)
        const discovered = await client.tools()
        for (const [name, tool] of Object.entries(discovered)) {
          const id = `mcp_${server.name}_${name}`
          if (tools[id]) {
            throw new Error(`Conflicting MCP tool name: ${id}`)
          }
          tools[id] = tool as ToolSet[string]
        }
      }
      return new McpSession(tools, clients)
    } catch (error) {
      await closeAll(clients)
      throw error
    }
  }

  async close(): Promise<void> {
    await closeAll(this.clients)
  }
}

async function closeAll(clients: McpClientLike[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close().catch(() => {})))
}
