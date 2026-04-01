#!/usr/bin/env bun
// Raw streaming test for claude-haiku-4.5 via Copilot API

import { loadToken } from "../src/provider/copilot-auth"
import { createCopilotFetch } from "../src/provider/copilot-fetch"

const token = loadToken()
if (!token) { console.error("No token found"); process.exit(1) }

const copilotFetch = createCopilotFetch({ getToken: async () => token })

console.log("=== Raw streaming test: claude-haiku-4.5 ===")
console.log("Sending request...")
const start = Date.now()

const response = await copilotFetch("https://api.githubcopilot.com/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-haiku-4.5",
    messages: [{ role: "user", content: "Say hello in one word." }],
    max_tokens: 20,
    stream: true,
  }),
})

console.log(`Response status: ${response.status} ${response.statusText}`)
for (const [k, v] of response.headers.entries()) {
  if (k.startsWith("x-") || k === "content-type") console.log(`  ${k}: ${v}`)
}

if (!response.ok) {
  const text = await response.text()
  console.log(`Error body: ${text}`)
  process.exit(1)
}

const reader = response.body?.getReader()
if (!reader) { console.error("No body reader"); process.exit(1) }

const decoder = new TextDecoder()
let chunks = 0
let fullText = ""

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  chunks++
  const text = decoder.decode(value, { stream: true })

  for (const line of text.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const json = JSON.parse(line.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          process.stdout.write(delta)
        }
        const finishReason = json.choices?.[0]?.finish_reason
        if (finishReason) console.log(`\n[finish_reason: ${finishReason}]`)
      } catch {}
    }
    if (line === "data: [DONE]") {
      console.log("[DONE]")
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  if (chunks % 5 === 0) console.log(`  [${elapsed}s, ${chunks} chunks so far]`)
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(`\n=== Completed in ${elapsed}s, ${chunks} chunks ===`)
console.log(`Full text: "${fullText}"`)
