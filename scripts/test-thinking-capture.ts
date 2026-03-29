#!/usr/bin/env bun
// Capture raw SSE stream from claude-sonnet-4.6 with thinking enabled.
// Stores every raw line to logs/thinking-capture.log for inspection.
// Run: bun --preload ./preload.ts scripts/test-thinking-capture.ts
import { loadToken } from "../src/provider/copilot-auth"
import { mkdirSync, appendFileSync, writeFileSync } from "fs"

const LOG_PATH = "logs/thinking-capture.log"
mkdirSync("logs", { recursive: true })

// Reset log file
writeFileSync(LOG_PATH, "")

const token = loadToken()
if (!token) { console.error("No Copilot token"); process.exit(1) }

const MODEL = "claude-sonnet-4.6"
const BUDGET = 5000

const PROMPT = `You are a distributed systems expert. Design the sync protocol for a real-time collaborative code editor (like Google Docs for code) supporting 10,000 concurrent users.

Specifically address:
1. Choose between OT and CRDT — justify your choice with trade-offs
2. How offline edits are merged when a user reconnects
3. The WebSocket architecture for cross-server broadcasting
4. How you'd handle the race condition: two users simultaneously delete the same line

Be concrete: include data structures, pseudocode where helpful, and explain failure modes.`

// Append to log file immediately
const log = (line: string) => appendFileSync(LOG_PATH, line + "\n")

log(`=== thinking-capture run ${new Date().toISOString()} ===`)
log(`model: ${MODEL}, budget: ${BUDGET}`)
log(`prompt: ${PROMPT.slice(0, 100)}...`)
log("---RAW SSE LINES---")

console.log(`Model:  ${MODEL}`)
console.log(`Budget: ${BUDGET} tokens`)
console.log(`Log:    ${LOG_PATH}`)
console.log("\nStreaming...\n")

const resp = await fetch("https://api.githubcopilot.com/v1/messages", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: 8000,
    stream: true,
    thinking: { type: "enabled", budget_tokens: BUDGET },
  }),
})

console.log(`HTTP ${resp.status} ${resp.statusText}`)
log(`HTTP ${resp.status} ${resp.statusText}`)

if (!resp.ok) {
  const err = await resp.text()
  log(`ERROR: ${err}`)
  console.error("Error:", err)
  process.exit(1)
}

// Counters
let lineCount = 0
let thinkingDeltas = 0
let textDeltas = 0
let thinkingText = ""
let responseText = ""

const reader = resp.body!.getReader()
const decoder = new TextDecoder()
let buf = ""

outer: while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })

  const lines = buf.split("\n")
  buf = lines.pop() ?? ""

  for (const raw of lines) {
    lineCount++
    log(raw) // flush every line immediately

    if (!raw.startsWith("data:")) continue
    const data = raw.slice(5).trim()
    if (data === "[DONE]") break outer

    try {
      const ev = JSON.parse(data)
      const type: string = ev.type ?? ""

      if (type === "content_block_start") {
        const cbType = ev.content_block?.type ?? "?"
        process.stdout.write(`[block:${cbType}]`)
      }
      if (type === "content_block_delta") {
        const delta = ev.delta
        if (delta?.type === "thinking_delta") {
          thinkingText += delta.thinking ?? ""
          thinkingDeltas++
          process.stdout.write("·")
        } else if (delta?.type === "text_delta") {
          responseText += delta.text ?? ""
          textDeltas++
          process.stdout.write(delta.text ?? "")
        }
      }
      if (type === "content_block_stop") {
        process.stdout.write("[/block]")
      }
    } catch {}
  }
}

process.stdout.write("\n")

log("---SUMMARY---")
log(`total raw lines: ${lineCount}`)
log(`thinking_delta events: ${thinkingDeltas}`)
log(`text_delta events: ${textDeltas}`)
log(`thinking text length: ${thinkingText.length} chars`)
log(`response text length: ${responseText.length} chars`)
log("---THINKING TEXT---")
log(thinkingText)
log("---RESPONSE TEXT (first 500 chars)---")
log(responseText.slice(0, 500))

console.log(`\n--- SUMMARY ---`)
console.log(`Raw SSE lines:          ${lineCount}`)
console.log(`thinking_delta events:  ${thinkingDeltas}`)
console.log(`text_delta events:      ${textDeltas}`)
console.log(`Thinking text (chars):  ${thinkingText.length}`)
console.log(`Response text (chars):  ${responseText.length}`)
console.log(`\nLog written to: ${LOG_PATH}`)

if (thinkingDeltas === 0) {
  console.error("\n✗ No thinking tokens found!")
  process.exit(1)
} else {
  console.log(`\n✓ Thinking tokens confirmed (${thinkingDeltas} delta events)`)
}

