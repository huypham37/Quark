// Tool: websearch — web search using Exa API
//
// Copy to ~/.config/atom/tools/websearch.ts

import { z } from "zod"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINT: "/mcp",
  DEFAULT_NUM_RESULTS: 8,
  TIMEOUT_MS: 25000,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

export default {
  id: "websearch",
  description:
    `Web search tool for finding current information. Today's date: ${new Date().toLocaleDateString()}. ` +
    "Searches the web and returns relevant results with context.",
  parameters: z.object({
    query: z.string().describe("Search query"),
    numResults: z
      .number()
      .optional()
      .describe("Number of results (default: 8)"),
    type: z
      .enum(["auto", "fast"])
      .optional()
      .describe("Search type: auto (balanced, default) or fast (quicker results)"),
  }),
  async execute(args: { query: string; numResults?: number; type?: "auto" | "fast" }, ctx: any) {
    if (!args.query) {
      throw new Error("query is required")
    }

    // Ask for permission
    await ctx.ask("websearch", args.query)

    const request: McpSearchRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: args.query,
          type: args.type || "auto",
          numResults: args.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
          livecrawl: "fallback",
        },
      },
    }

    // Create timeout signal
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), API_CONFIG.TIMEOUT_MS)

    // Combine with context abort signal
    const abortHandler = () => timeoutController.abort()
    ctx.abort.addEventListener("abort", abortHandler)

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINT}`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: timeoutController.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Search error (${response.status}): ${errorText}`)
      }

      const responseText = await response.text()

      // Parse SSE response
      const lines = responseText.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data: McpSearchResponse = JSON.parse(line.substring(6))
          if (data.result?.content?.length > 0) {
            return {
              title: `Web search: ${args.query}`,
              output: data.result.content[0].text,
              metadata: { query: args.query },
            }
          }
        }
      }

      return {
        title: `Web search: ${args.query}`,
        output: "No search results found. Try a different query.",
        metadata: { query: args.query, empty: true },
      }
    } catch (error) {
      clearTimeout(timeout)
      ctx.abort.removeEventListener("abort", abortHandler)

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Search request timed out")
      }
      throw error
    } finally {
      ctx.abort.removeEventListener("abort", abortHandler)
    }
  },
}
