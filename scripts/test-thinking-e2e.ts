#!/usr/bin/env bun
// End-to-end test: verify thinking events flow through @ai-sdk/anthropic + Copilot
// Run: bun --preload ./preload.ts scripts/test-thinking-e2e.ts
import { createCopilotAnthropicProvider, setCopilotThinking, getCopilotThinkingBudget } from "../src/provider/provider"
import { loadToken } from "../src/provider/copilot-auth"
import { streamText } from "ai"

// Ensure token is available
const token = loadToken()
if (!token) { console.error("No Copilot token"); process.exit(1) }

const MODEL = "claude-sonnet-4.5"
const BUDGET = 3000

console.log(`Testing thinking via @ai-sdk/anthropic + Copilot /v1/messages`)
console.log(`Model: ${MODEL}, budget: ${BUDGET}`)

// Set thinking budget
setCopilotThinking(BUDGET)
console.log(`Thinking budget set: ${getCopilotThinkingBudget()}`)

const provider = createCopilotAnthropicProvider({
  getToken: async () => {
    const t = loadToken()
    if (!t) throw new Error("No token")
    return t
  },
})

const model = provider(MODEL)

console.log("\nStreaming response...\n")

let hasThinkingStart = false
let hasThinkingDelta = false
let hasThinkingEnd = false
let thinkingText = ""
let responseText = ""
let eventTypes: string[] = []

try {
  const result = streamText({
    model,
    messages: [{ role: "user", content: "What is 17 × 23? Think step by step." }],
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: BUDGET }
      }
    },
    maxRetries: 0,
  })

  for await (const event of result.fullStream) {
    eventTypes.push(event.type)
    switch (event.type) {
      case "reasoning-start":
        hasThinkingStart = true
        process.stdout.write("[THINKING START]\n")
        break
      case "reasoning-delta":
        hasThinkingDelta = true
        thinkingText += (event as any).text ?? ""
        process.stdout.write(".")
        break
      case "reasoning-end":
        hasThinkingEnd = true
        process.stdout.write("\n[THINKING END]\n")
        break
      case "text-delta":
        responseText += (event as any).text ?? ""
        process.stdout.write((event as any).text ?? "")
        break
      case "finish":
        process.stdout.write("\n[DONE]\n")
        break
    }
  }
} catch (err: any) {
  console.error("\nError:", err.message ?? err)
  console.error("Status:", err.statusCode)
  process.exit(1)
}

console.log("\n--- RESULTS ---")
console.log(`Event types seen: ${[...new Set(eventTypes)].join(", ")}`)
console.log(`hasThinkingStart: ${hasThinkingStart}`)
console.log(`hasThinkingDelta: ${hasThinkingDelta}`)
console.log(`hasThinkingEnd:   ${hasThinkingEnd}`)
console.log(`Thinking length:  ${thinkingText.length} chars`)
console.log(`Response length:  ${responseText.length} chars`)
console.log(`Thinking preview: ${thinkingText.slice(0, 150)}`)
console.log(`Response:         ${responseText}`)

if (!hasThinkingStart || !hasThinkingDelta || !hasThinkingEnd) {
  console.error("\n✗ FAIL: Missing thinking events!")
  process.exit(1)
} else {
  console.log("\n✓ PASS: Thinking events received correctly!")
}
