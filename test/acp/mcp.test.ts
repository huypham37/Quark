import { describe, expect, test } from "bun:test"
import { McpSession, type McpClientFactory } from "../../src/acp/mcp"
import { tool } from "ai"
import { z } from "zod"

const server = { name: "weather", type: "http" as const, url: "https://example.test/mcp", headers: [] }

function fakeTool() {
  return tool({
    description: "Gets weather",
    inputSchema: z.object({ city: z.string() }),
    execute: async () => "sunny",
  })
}

describe("McpSession", () => {
  test("discovers tools under deterministic server-prefixed names", async () => {
    const factory: McpClientFactory = async () => ({
      tools: async () => ({ forecast: fakeTool() }),
      close: async () => {},
    })

    const session = await McpSession.connect([server], factory)
    expect(Object.keys(session.tools)).toEqual(["mcp_weather_forecast"])
  })

  test("closes every opened client when configuration fails", async () => {
    let firstClosed = false
    const factory: McpClientFactory = async (definition) => {
      if (definition.name === "bad") throw new Error("unreachable")
      return {
        tools: async () => ({ forecast: fakeTool() }),
        close: async () => { firstClosed = true },
      }
    }

    await expect(McpSession.connect([server, { ...server, name: "bad" }], factory)).rejects.toThrow("unreachable")
    expect(firstClosed).toBe(true)
  })

  test("rejects duplicate server names before connecting twice", async () => {
    let connects = 0
    const factory: McpClientFactory = async () => {
      connects++
      return { tools: async () => ({}), close: async () => {} }
    }

    await expect(McpSession.connect([server, server], factory)).rejects.toThrow("Duplicate MCP server name")
    expect(connects).toBe(1)
  })
})
