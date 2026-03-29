#!/usr/bin/env bun
// Raw SSE response inspection — bypasses AI SDK to see what Copilot actually sends
// Run: bun --preload ./preload.ts scripts/test-thinking-raw.ts
import { loadToken } from "../src/provider/copilot-auth"

const token = await loadToken()
if (!token) { console.error("No token"); process.exit(1) }

const body = JSON.stringify({
  model: "claude-sonnet-4.5",
  messages: [{ role: "user", content: "What is 2+2? Answer in one word." }],
  stream: true,
  thinking: { type: "enabled", budget_tokens: 5000 },
  max_tokens: 2000,
})

console.log("Sending raw SSE request with thinking param...")
const resp = await fetch("https://api.githubcopilot.com/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Openai-Intent": "conversation-edits",
    "x-initiator": "user",
  },
  body,
})

console.log("Status:", resp.status, resp.statusText)
if (!resp.ok) {
  const err = await resp.text()
  console.error("Error body:", err)
  process.exit(1)
}

const text = await resp.text()
const lines = text.split("\n").filter(l => l.trim())
console.log(`\nTotal SSE lines: ${lines.length}`)
console.log("\n=== First 30 lines ===")
lines.slice(0, 30).forEach(l => console.log(l))
console.log("\n=== Event types in data lines ===")
const types = new Map<string, number>()
for (const line of lines) {
  if (!line.startsWith("data: ") || line === "data: [DONE]") continue
  try {
    const d = JSON.parse(line.slice(6))
    const t = d.type ?? (d.choices?.[0]?.delta ? "delta" : JSON.stringify(Object.keys(d)))
    types.set(t, (types.get(t) ?? 0) + 1)
  } catch {}
}
for (const [t, c] of types) console.log(`  ${t}: ${c}`)
