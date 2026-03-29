#!/usr/bin/env bun
// Test extended thinking — one request, complex prompt, log all stream events.
// Usage: bun --preload ./preload.ts scripts/test-thinking.ts
//
// Stores raw event log to /tmp/quark-thinking-response.log

import { streamText } from "ai"
import * as fs from "fs"
import { loadToken } from "../src/provider/copilot-auth"
import { createCopilotFetch } from "../src/provider/copilot-fetch"
import { createOpenAI } from "@ai-sdk/openai"

const LOG = "/tmp/quark-thinking-response.log"
const MODEL = "claude-sonnet-4.5" // cheapest sonnet with thinking support

// ---- Auth ----
const token = loadToken()
if (!token) {
  console.error("No Copilot token found. Run scripts/copilot-login.ts first.")
  process.exit(1)
}

// ---- Fetch wrapper with thinking budget ----
const copilotFetch = createCopilotFetch({
  getToken: async () => token,
  thinkingBudget: 8000,
})

const provider = createOpenAI({
  name: "copilot",
  baseURL: "https://api.githubcopilot.com",
  apiKey: "copilot",
  fetch: copilotFetch as any,
})

// ---- Complex prompt designed to trigger extended thinking ----
const PROMPT = `
You are a senior software architect. A startup CTO asks you:

"We have a monolithic Node.js app (200k LOC) that handles 50k req/s at peak.
We want to migrate to microservices over 18 months without downtime.
Our team has 12 engineers: 8 backend, 2 frontend, 2 DevOps.
We currently use PostgreSQL (single instance, 2TB), Redis for caching,
and RabbitMQ for async jobs. The monolith has 3 major domains:
user/auth, billing/payments, and core product logic.

Question: Give me a concrete phased migration plan. Be specific about:
1. Which domain to extract first and why
2. How to handle the shared PostgreSQL database during migration
3. How to avoid downtime during the cutover
4. Team allocation across the 3 phases
5. Key risks and mitigation strategies"

Think through this carefully before answering. Provide a structured plan.
`.trim()

// ---- Log helper ----
function log(data: unknown) {
  const line = JSON.stringify(data) + "\n"
  fs.appendFileSync(LOG, line)
  process.stdout.write(".")
}

// ---- Run ----
fs.writeFileSync(LOG, `=== Thinking Test @ ${new Date().toISOString()} ===\nModel: ${MODEL}\n\n`)
console.log(`Sending request to ${MODEL} with thinking budget=8000...`)
console.log(`Logging all events to ${LOG}`)
console.log("Progress: ", { end: "" })

try {
  const result = streamText({
    model: provider.chat(MODEL),
    prompt: PROMPT,
    maxTokens: 4000,
    maxRetries: 0,
  })

  for await (const event of result.fullStream) {
    log({ type: event.type, ...(event as any) })
  }

  console.log("\nDone.")
  console.log(`\nFull log: ${LOG}`)
  console.log(`\nEvent summary:`)

  // Print a quick summary
  const lines = fs.readFileSync(LOG, "utf-8").split("\n").filter(l => l.startsWith("{"))
  const counts: Record<string, number> = {}
  for (const line of lines) {
    try {
      const ev = JSON.parse(line)
      counts[ev.type] = (counts[ev.type] ?? 0) + 1
    } catch {}
  }
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type}: ${count}`)
  }

} catch (err: any) {
  console.error("\nError:", err?.message ?? err)
  fs.appendFileSync(LOG, `\n=== ERROR ===\n${err}\n`)
  process.exit(1)
}
