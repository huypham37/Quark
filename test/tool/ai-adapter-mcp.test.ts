import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import { z } from "zod"
import { resolveToolSet } from "../../src/tool/ai-adapter"
import { defaultAgent } from "../../src/agent"

const agent = { ...defaultAgent, tools: [], permissions: [{ tool: "*", action: "allow" as const }] }

describe("resolveToolSet MCP tools", () => {
  test("merges server tools without replacing profile tools", async () => {
    const external = tool({
      description: "External tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => `result: ${value}`,
    })
    const tools = resolveToolSet(agent, "session", "message", new AbortController().signal, {
      mcp_demo_echo: external,
    })

    expect(tools.mcp_demo_echo).toBeDefined()
    await expect(tools.mcp_demo_echo!.execute!({ value: "ok" }, {
      toolCallId: "call",
      messages: [],
    } as any)).resolves.toBe("result: ok")
  })
})
