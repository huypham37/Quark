#!/usr/bin/env bun
// End-to-end test — boots the agent, sends a prompt, and prints results
//
// Usage: bun scripts/e2e.ts "your prompt here" [--model gpt-5-mini]
// Requires: a valid Copilot token (run `bun scripts/copilot-login.ts` first)

import { bootstrap } from "../src/bootstrap"
import { prompt } from "../src/session/prompt"
import { loadMessages } from "../src/session/message"
import { parseModelSpec } from "../src/config/config"
import type { AgentConfig } from "../src/agent"

// Minimal agent — only built-in tools, no profile tools needed
const testAgent: AgentConfig = {
  id: "test",
  name: "Test",
  prompt: "You are a helpful assistant.",
  tools: ["read", "skill"],
  skills: [],
}

async function main() {
  const args = process.argv.slice(2)
  const modelIdx = args.indexOf("--model")
  const modelId = modelIdx !== -1 ? args[modelIdx + 1] : undefined
  // Remove --model and its value from args only when the flag is present
  const filteredArgs = modelIdx !== -1
    ? args.filter((_, i) => i !== modelIdx && i !== modelIdx + 1)
    : args
  const input = filteredArgs[0] ?? "What is 2 + 2? Reply with just the number."

  console.log("=== Atom E2E Test ===")
  console.log(`Prompt: ${input}`)
  if (modelId) console.log(`Model: ${modelId}`)
  console.log()

  // Bootstrap tools + DB
  await bootstrap()

  // Run the agent loop
  console.log("Starting agent loop...")
  const start = Date.now()

  const result = await prompt({
    parts: [{ type: "text", text: input }],
    agent: testAgent,
    model: modelId
      ? (() => { const p = parseModelSpec(modelId); return { provider: p.provider ?? "copilot", model: p.model } })()
      : undefined,
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\nAgent loop completed in ${elapsed}s`)
  console.log(`Session ID: ${result.sessionId}`)

  // Load and display the conversation
  const { messages, parts } = loadMessages(result.sessionId)
  console.log(`\nMessages: ${messages.length}`)
  console.log(`Parts: ${parts.length}`)
  console.log()

  for (const msg of messages) {
    const msgParts = parts.filter((p) => p.messageId === msg.id)
    console.log(`--- ${msg.role.toUpperCase()} (${msg.id.slice(0, 8)}) ---`)

    for (const p of msgParts) {
      const data = JSON.parse(p.data)
      if (p.type === "text") {
        console.log(data.text)
      } else if (p.type === "tool") {
        console.log(`[tool: ${data.tool}] status=${data.status}`)
        if (data.input) console.log(`  input: ${JSON.stringify(data.input).slice(0, 200)}`)
        if (data.output) console.log(`  output: ${data.output.slice(0, 200)}`)
        if (data.error) console.log(`  error: ${data.error}`)
      } else if (p.type === "step-finish") {
        console.log(`[step-finish] reason=${data.reason} tokens=${JSON.stringify(data.tokens)}`)
      }
    }
    console.log()
  }

  console.log("=== Done ===")
}

main().catch((err) => {
  console.error("E2E test failed:", err)
  process.exit(1)
})
