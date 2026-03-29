#!/usr/bin/env bun
// Spy on actual request body. Run: bun --preload ./preload.ts scripts/test-thinking-spy.ts
import { loadToken } from "../src/provider/copilot-auth"
import { createCopilotFetch } from "../src/provider/copilot-fetch"
import { createOpenAI } from "@ai-sdk/openai"
import { streamText } from "ai"

const token = await loadToken()
if (!token) { console.error("No token"); process.exit(1) }

// Wrap with a spy that logs the actual body
const spyFetch = createCopilotFetch({ 
  getToken: async () => token, 
  thinkingBudget: 8000,
  fetch: async (input: any, init?: any) => {
    if (init?.body && typeof init.body === "string") {
      const b = JSON.parse(init.body)
      console.log("\n--- BODY SENT TO COPILOT API ---")
      console.log("model:", b.model)
      console.log("thinking:", JSON.stringify(b.thinking ?? "(absent)"))
      console.log("messages count:", b.messages?.length)
      console.log("--------------------------------\n")
    }
    return globalThis.fetch(input, init)
  }
})

const provider = createOpenAI({
  name: "copilot",
  baseURL: "https://api.githubcopilot.com",
  apiKey: "copilot",
  fetch: spyFetch as any,
})

console.log("Sending test request...")
try {
  const result = streamText({
    model: provider.chat("claude-sonnet-4.5"),
    prompt: "What is 2+2? Answer in one word.",
    maxRetries: 0,
  })
  let text = ""
  for await (const ev of result.fullStream) {
    if (ev.type === "text-delta") text += (ev as any).textDelta
    else console.log("[event]", ev.type)
  }
  console.log("Response:", text)
} catch(e: any) {
  console.error("Error:", e.message?.slice(0, 300))
}
