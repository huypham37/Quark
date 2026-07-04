#!/usr/bin/env bun
// Profile time-to-first-token (TTFT) over the ACP (Agent Client Protocol).
// Spawns `quark acp`, initializes, sets the model, sends a prompt,
// and measures the time to the first `agent_message_chunk` notification.

import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

const MODEL = process.argv[2] || "opencode/deepseek-v4-flash"
const RUNS = parseInt(process.argv[3] || "5", 10)
const PROFILE = process.argv[4] || "coder"

const QUARK_CMD = "bun"
const QUARK_ARGS = ["run", "src/cli.ts", "acp", "--profile", PROFILE]

interface TTFTResult {
  run: number
  ttft: number
  total: number
  firstToken: string
  tokenCount: number
  tokensPerSecond: number
  stopReason: string
}

type RpcMessage = Record<string, unknown>

// ─── ACP Client ───────────────────────────────────────────────────────────────

function createAcpClient(): {
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: () => Promise<RpcMessage>
  kill: () => void
} {
  const child = spawn(QUARK_CMD, QUARK_ARGS, {
    stdio: ["pipe", "pipe", "pipe"],
  })

  child.stderr!.on("data", () => {}) // swallow debug output

  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const notifyQueue: RpcMessage[] = []
  let notifyResolve: ((v: RpcMessage) => void) | null = null

  const rl = createInterface({ input: child.stdout! })

  rl.on("line", (line: string) => {
    let msg: RpcMessage
    try { msg = JSON.parse(line) } catch { return }

    if ("id" in msg && !("method" in msg)) {
      const id = msg.id as number
      const p = pending.get(id)
      if (p) {
        pending.delete(id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
      return
    }

    // Notification or agent→client request
    if (notifyResolve) {
      notifyResolve(msg)
      notifyResolve = null
    } else {
      notifyQueue.push(msg)
    }
  })

  child.on("exit", () => {
    for (const [, p] of pending) p.reject(new Error("Process exited"))
    pending.clear()
  })

  return {
    request(method: string, params?: unknown): Promise<unknown> {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
      })
    },
    nextNotification(): Promise<RpcMessage> {
      if (notifyQueue.length > 0) {
        return Promise.resolve(notifyQueue.shift()!)
      }
      return new Promise((resolve) => { notifyResolve = resolve })
    },
    kill(): void {
      child.stdin!.end()
      child.kill()
    },
  }
}

// ─── Single Run ──────────────────────────────────────────────────────────────

async function measureTTFT(run: number): Promise<TTFTResult> {
  const client = createAcpClient()

  try {
    // 1. Initialize
    await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "ttft-profiler", title: "TTFT Profiler", version: "1.0.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })

    // 2. Create session
    const sessResult = (await client.request("session/new", {
      cwd: process.cwd(),
    })) as any
    const sessionId = sessResult.sessionId as string

    // 3. Set the model
    await client.request("session/set_config_option", {
      sessionId,
      configOptions: [{ name: "model", value: MODEL }],
    })

    // 4. Send prompt and measure
    const promptStart = Date.now()
    let ttft = 0
    let firstToken = ""
    let tokenCount = 0

    // Fire the prompt request
    const promptPromise = client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Write a short paragraph about the benefits of TypeScript in modern web development." }],
    })

    // Consume notifications until the prompt response arrives.
    // The prompt response comes through the pending map (not the notify queue),
    // so promptPromise resolves independently.
    while (true) {
      // Race: next notification vs prompt completion
      const result = await Promise.race([
        promptPromise.then(r => ({ kind: "done" as const, stopReason: (r as any)?.stopReason ?? "end_turn" })),
        client.nextNotification().then(msg => ({ kind: "notification" as const, msg })),
      ])

      if (result.kind === "done") {
        const total = Date.now() - promptStart
        const tps = tokenCount > 0 ? tokenCount / (total / 1000) : 0
        return {
          run, ttft, total,
          firstToken,
          tokenCount,
          tokensPerSecond: tps,
          stopReason: result.stopReason,
        }
      }

      // Process notification
      const msg = result.msg
      if (msg.method === "session/update") {
        const params = msg.params as Record<string, unknown> | undefined
        if (params?.sessionUpdate === "agent_message_chunk") {
          const content = params.content as { type: string; text: string } | undefined
          if (content?.text) {
            if (!ttft) {
              ttft = Date.now() - promptStart
              firstToken = content.text
            }
            tokenCount++
          }
        }
      }
    }
  } finally {
    client.kill()
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

console.log(`=== ACP TTFT Profiling: ${MODEL} (${RUNS} runs, profile: ${PROFILE}) ===\n`)

const results: TTFTResult[] = []

for (let i = 1; i <= RUNS; i++) {
  try {
    const result = await measureTTFT(i)
    results.push(result)
    console.log(
      `Run ${i}: TTFT=${result.ttft}ms, Total=${result.total}ms, ` +
      `Tokens=${result.tokenCount}, TPS=${result.tokensPerSecond.toFixed(1)}, ` +
      `Stop="${result.stopReason}", First="${result.firstToken.slice(0, 40).trim()}"`
    )
  } catch (err: any) {
    console.log(`Run ${i}: ERROR — ${err.message}`)
  }
}

if (results.length === 0) {
  console.log("\nNo successful runs. Exiting.")
  process.exit(1)
}

// Stats
const ttfts = results.map(r => r.ttft)
const totals = results.map(r => r.total)
const tpss = results.map(r => r.tokensPerSecond)

const avg = ttfts.reduce((a, b) => a + b, 0) / ttfts.length
const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length
const min = Math.min(...ttfts)
const max = Math.max(...ttfts)
const sorted = [...ttfts].sort((a, b) => a - b)
const p50 = sorted[Math.floor(sorted.length * 0.5)]
const p90 = sorted[Math.floor(sorted.length * 0.9)]
const avgTPS = tpss.reduce((a, b) => a + b, 0) / tpss.length
const avgTokens = results.reduce((a, b) => a + b.tokenCount, 0) / results.length

console.log(`\n=== ACP TTFT Stats (${MODEL}) ===`)
console.log(`  Avg TTFT:   ${avg.toFixed(0)}ms`)
console.log(`  Min TTFT:   ${min}ms`)
console.log(`  Max TTFT:   ${max}ms`)
console.log(`  P50 TTFT:   ${p50}ms`)
console.log(`  P90 TTFT:   ${p90}ms`)
console.log(`  Avg Total:  ${avgTotal.toFixed(0)}ms`)
console.log(`  Avg Tokens: ${avgTokens.toFixed(0)}`)
console.log(`  Avg TPS:    ${avgTPS.toFixed(1)} tok/s`)
console.log(`\n  Raw TTFTs: [${ttfts.join(", ")}]`)
