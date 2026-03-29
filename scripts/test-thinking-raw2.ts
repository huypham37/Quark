#!/usr/bin/env bun
// Try different models and param formats
// Run: bun --preload ./preload.ts scripts/test-thinking-raw2.ts
import { loadToken } from "../src/provider/copilot-auth"

const token = await loadToken()
if (!token) { console.error("No token"); process.exit(1) }

const PROMPT = "Solve this step by step: A train leaves NYC at 60mph, another from LA at 80mph, 2800 miles apart. When do they meet?"

async function testModel(model: string, extraParams: Record<string, any>) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: PROMPT }],
    stream: true,
    max_tokens: 3000,
    ...extraParams,
  })

  console.log(`\n=== ${model} | params: ${JSON.stringify(extraParams)} ===`)
  const resp = await fetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Openai-Intent": "conversation-edits",
    },
    body,
  })

  if (!resp.ok) {
    console.log("  ERROR:", resp.status, await resp.text())
    return
  }

  const text = await resp.text()
  const lines = text.split("\n").filter(l => l.startsWith("data:") && l !== "data: [DONE]")
  
  // Check for thinking-related content
  let hasThinking = false
  let allContent = ""
  for (const line of lines) {
    try {
      const d = JSON.parse(line.slice(5).trim())
      const c = d.choices?.[0]?.delta?.content ?? ""
      if (c) allContent += c
      if (c?.includes("<think>") || c?.includes("</think>") || d.type?.includes("think")) {
        hasThinking = true
      }
    } catch {}
  }
  
  console.log(`  Lines: ${lines.length}, hasThinking: ${hasThinking}`)
  if (allContent.startsWith("<think>") || allContent.slice(0, 100).includes("think")) {
    console.log("  First 200 chars:", allContent.slice(0, 200))
  } else {
    console.log("  First 100 chars:", allContent.slice(0, 100))
  }
}

// Test 1: thinking param (Claude native format)
await testModel("claude-sonnet-4.5", { thinking: { type: "enabled", budget_tokens: 5000 } })

// Test 2: claude-opus-4.5 with thinking
await testModel("claude-opus-4.5", { thinking: { type: "enabled", budget_tokens: 5000 } })

// Test 3: reasoning_effort (OpenAI o-model style)
await testModel("claude-sonnet-4.5", { reasoning_effort: "high" })

// Test 4: no thinking params  
await testModel("claude-sonnet-4.5", {})

