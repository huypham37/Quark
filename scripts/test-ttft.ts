#!/usr/bin/env bun
// Profile time-to-first-token (TTFT) for streaming models

import { loadToken } from "../src/provider/copilot-auth"
import { createCopilotFetch } from "../src/provider/copilot-fetch"

const MODEL = process.argv[2] || "gpt-5-mini"
const RUNS = parseInt(process.argv[3] || "5", 10)

const token = loadToken()
if (!token) { console.error("No token found"); process.exit(1) }

const copilotFetch = createCopilotFetch({ getToken: async () => token })

interface TTFTResult {
  run: number
  ttft: number      // time to first token (ms)
  total: number     // total time (ms)
  firstToken: string
  tokenCount: number
  tokensPerSecond: number
}

async function measureTTFT(run: number): Promise<TTFTResult> {
  const start = Date.now()
  let ttft = 0
  let firstToken = ""
  let tokenCount = 0

  const response = await copilotFetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Write a short paragraph about the benefits of TypeScript in modern web development." }],
      max_tokens: 200,
      stream: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error("No body reader")

  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const json = JSON.parse(line.slice(6))
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            if (!ttft) {
              ttft = Date.now() - start
              firstToken = delta
            }
            tokenCount++
          }
        } catch {}
      }
    }
  }

  const total = Date.now() - start
  const tokensPerSecond = tokenCount / (total / 1000)
  return { run, ttft, total, firstToken, tokenCount, tokensPerSecond }
}

console.log(`=== TTFT Profiling: ${MODEL} (${RUNS} runs) ===\n`)

const results: TTFTResult[] = []

for (let i = 1; i <= RUNS; i++) {
  const result = await measureTTFT(i)
  results.push(result)
  console.log(`Run ${i}: TTFT=${result.ttft}ms, Total=${result.total}ms, Tokens=${result.tokenCount}, TPS=${result.tokensPerSecond.toFixed(1)}, First="${result.firstToken.trim()}"`)
}

// Stats
const ttfts = results.map(r => r.ttft)
const tpss = results.map(r => r.tokensPerSecond)
const avg = ttfts.reduce((a, b) => a + b, 0) / ttfts.length
const min = Math.min(...ttfts)
const max = Math.max(...ttfts)
const sorted = [...ttfts].sort((a, b) => a - b)
const p50 = sorted[Math.floor(sorted.length * 0.5)]
const p90 = sorted[Math.floor(sorted.length * 0.9)]
const avgTPS = tpss.reduce((a, b) => a + b, 0) / tpss.length

console.log(`\n=== TTFT Stats (${MODEL}) ===`)
console.log(`  Avg:  ${avg.toFixed(0)}ms`)
console.log(`  Min:  ${min}ms`)
console.log(`  Max:  ${max}ms`)
console.log(`  P50:  ${p50}ms`)
console.log(`  P90:  ${p90}ms`)
console.log(`\n=== Tokens Per Second ===`)
console.log(`  Avg:  ${avgTPS.toFixed(1)} tok/s`)
console.log(`  Min:  ${Math.min(...tpss).toFixed(1)} tok/s`)
console.log(`  Max:  ${Math.max(...tpss).toFixed(1)} tok/s`)
