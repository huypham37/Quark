#!/usr/bin/env bun
// Check which thinking-specific model IDs Copilot accepts
// Run: bun --preload ./preload.ts scripts/test-thinking-models.ts
import { loadToken } from "../src/provider/copilot-auth"

const token = await loadToken()
if (!token) { console.error("No token"); process.exit(1) }

const MODELS_TO_TRY = [
  "claude-sonnet-3.7-thinking",
  "claude-sonnet-3.7-thinking-20250219",
  "claude-3-7-sonnet-thinking",
  "claude-sonnet-4.5-thinking",
  "claude-sonnet-4.6-thinking",
  "claude-opus-4.5-thinking",
  "claude-opus-4.6-thinking",
]

for (const model of MODELS_TO_TRY) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "Say hi." }],
    stream: false,
    max_tokens: 10,
  })
  const resp = await fetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Openai-Intent": "conversation-edits",
    },
    body,
  })
  const text = await resp.text()
  const prefix = resp.ok ? "OK" : `ERR ${resp.status}`
  const snippet = text.slice(0, 120).replace(/\n/g, " ")
  console.log(`${prefix} | ${model} | ${snippet}`)
}
