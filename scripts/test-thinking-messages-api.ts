#!/usr/bin/env bun
// Test native Anthropic Messages API endpoint via GitHub Copilot
// Run: bun --preload ./preload.ts scripts/test-thinking-messages-api.ts
import { loadToken } from "../src/provider/copilot-auth"

const token = await loadToken()
if (!token) { console.error("No token"); process.exit(1) }

const PROMPT = "What is 1+1? Reply in one sentence."


async function testEndpoint(url: string, model: string, thinkingParam: Record<string, any>) {
  const body: Record<string, any> = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: 1024,
    stream: true,
    ...thinkingParam,
  }

  console.log(`\n=== POST ${url} ===`)
  console.log(`    model: ${model}`)
  console.log(`    thinking: ${JSON.stringify(thinkingParam)}`)

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify(body),
  })

  console.log(`    Status: ${resp.status} ${resp.statusText}`)

  if (!resp.ok) {
    const errText = await resp.text()
    console.log(`    Error body: ${errText.slice(0, 400)}`)
    return
  }

  // Stream and collect events
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let rawBuffer = ""
  let eventCount = 0
  let hasThinkingEvent = false
  let thinkingText = ""
  let responseText = ""

  outer: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    rawBuffer += decoder.decode(value, { stream: true })

    const lines = rawBuffer.split("\n")
    rawBuffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") break outer

      try {
        const event = JSON.parse(data)
        eventCount++

        // Print first 5 events
        if (eventCount <= 5) {
          console.log(`    event[${eventCount}]: ${JSON.stringify(event).slice(0, 200)}`)
        }

        // Check for thinking content
        const type = event.type
        if (type === "content_block_start" && event.content_block?.type === "thinking") {
          hasThinkingEvent = true
          console.log(`    *** THINKING BLOCK STARTED ***`)
        }
        if (type === "content_block_delta") {
          const delta = event.delta
          if (delta?.type === "thinking_delta") {
            hasThinkingEvent = true
            thinkingText += delta.thinking ?? ""
          } else if (delta?.type === "text_delta") {
            responseText += delta.text ?? ""
          }
        }
      } catch {}
    }
  }

  console.log(`    Total events: ${eventCount}`)
  console.log(`    Has thinking: ${hasThinkingEvent}`)
  if (thinkingText) console.log(`    Thinking (first 200): ${thinkingText.slice(0, 200)}`)
  if (responseText) console.log(`    Response (first 200): ${responseText.slice(0, 200)}`)
}

const MESSAGES_URL = "https://api.githubcopilot.com/v1/messages"

// Test 1: Sonnet 4.6 with adaptive thinking (new API)
await testEndpoint(MESSAGES_URL, "claude-sonnet-4.6", {
  thinking: { type: "adaptive" },
  output_config: { effort: "low" },
})

// Test 2: Sonnet 4.6 with budget_tokens (older format)
await testEndpoint(MESSAGES_URL, "claude-sonnet-4.6", {
  thinking: { type: "enabled", budget_tokens: 2000 },
})

// Test 3: Sonnet 4.5 with budget_tokens
await testEndpoint(MESSAGES_URL, "claude-sonnet-4.5", {
  thinking: { type: "enabled", budget_tokens: 2000 },
})

// Test 4: No thinking — sanity check
await testEndpoint(MESSAGES_URL, "claude-sonnet-4.5", {})
