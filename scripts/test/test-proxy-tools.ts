#!/usr/bin/env bun
import { streamText, tool } from "ai"
import { resolveModel } from "../src/session/prompt"
import { z } from "zod"

const model = await resolveModel(undefined, "main")
console.log("Model:", model.modelId)

const result = streamText({
  model,
  messages: [{ role: "user", content: "List files in the current directory using bash." }],
  tools: {
    bash: tool({
      description: "Run a shell command",
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        const proc = Bun.spawn(["bash", "-c", command], { stdout: "pipe" })
        const out = await new Response(proc.stdout).text()
        return out.trim()
      }
    })
  },
  maxSteps: 3,
})

for await (const part of result.fullStream) {
  const p = part as any
  if (p.type === "text-delta") {
    const t = p.textDelta ?? p.text ?? ""
    if (t) process.stdout.write(t)
  } else if (p.type === "tool-call") {
    console.log(`[TOOL CALL] ${p.toolName}(${JSON.stringify(p.args ?? p.input)})`)
  } else if (p.type === "tool-result") {
    console.log(`[TOOL RESULT]\n${String(p.result ?? p.output ?? "").slice(0, 500)}`)
  } else if (p.type === "step-finish" || p.type === "finish") {
    console.log(`[STEP FINISH] reason=${p.finishReason}`)
  }
}
console.log("\nDone.")
