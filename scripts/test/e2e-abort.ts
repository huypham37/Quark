#!/usr/bin/env bun
// E2E test for Issue #154 — aborted assistant messages must not pollute context
//
// Usage: bun scripts/test/e2e-abort.ts
// Requires: a valid Copilot token (run `bun scripts/auth/copilot-login.ts` first)

import { createRunner } from "../../packages/runner/src/runner"
import { defineAgent } from "../../packages/runner/src/agent"
import { createJsonlSessionStore } from "../../packages/runner/src/session/session"
import { getSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { loadPluginFns, createPluginContext } from "../../packages/quark/src/plugin-loader"
import { loadMessages, toModelMessages } from "../../packages/runner/src/session/message"

const MODEL = "opencode/deepseek-v4-flash"
const ABORT_AFTER_MS = 3000

async function main() {
  console.log("=== Issue #154 Abort E2E Test ===")
  console.log(`Model: ${MODEL}`)
  console.log(`Abort after: ${ABORT_AFTER_MS}ms`)
  console.log()

  const runner = createRunner({
    agent: defineAgent({ id: "abort-e2e", instructions: "You are a helpful assistant.", tools: [], model: MODEL }),
    store: createJsonlSessionStore(getSessionStorageRoot()),
    plugins: (await loadPluginFns()).fns,
    pluginContext: createPluginContext(),
  })

  // 1. Start a prompt that will produce a long streamed response
  const firstPrompt = "Write a 1000 word essay about the history of the bicycle. Do not stop early."
  console.log(`User: ${firstPrompt}`)

  let sessionIdToCancel: string | null = null
  const onAssistantStart = (data: { sessionId: string; messageId: string }) => {
    sessionIdToCancel = data.sessionId
  }
  runner.bus.on("assistant-message-start", onAssistantStart)

  const firstPromise = runner.prompt({
    parts: [{ type: "text", text: firstPrompt }],
    model: MODEL,
  })

  // 2. Abort shortly after the assistant message starts
  await new Promise((resolve) => setTimeout(resolve, ABORT_AFTER_MS))
  console.log("[test] aborting mid-generation...")

  runner.bus.off("assistant-message-start", onAssistantStart)

  if (sessionIdToCancel) {
    runner.cancel(sessionIdToCancel)
  } else {
    console.error("[FAIL] assistant-message-start never fired — cannot cancel")
    process.exit(1)
  }

  let firstSessionId: string
  try {
    const result = await firstPromise
    firstSessionId = result.sessionId
    console.log(`[test] first prompt completed, sessionId=${firstSessionId.slice(0, 8)}`)
  } catch (err) {
    console.error("[test] first prompt threw:", err)
    process.exit(1)
  }

  // 3. Verify the aborted message is persisted with finish="aborted"
  const { messages: afterAbort, parts: afterAbortParts } = loadMessages(firstSessionId, runner.store)
  const assistantMessages = afterAbort.filter((m) => m.role === "assistant")
  const abortedMessage = assistantMessages.find((m) => m.finish === "aborted")

  if (!abortedMessage) {
    console.error("[FAIL] no assistant message with finish='aborted' found")
    console.log("Assistant messages:", assistantMessages.map((m) => ({ id: m.id.slice(0, 8), finish: m.finish })))
    process.exit(1)
  }

  const abortedText = afterAbortParts
    .filter((p) => p.messageId === abortedMessage.id && p.type === "text")
    .map((p) => JSON.parse(p.data).text as string)
    .join("")

  console.log(`[test] aborted message id=${abortedMessage.id.slice(0, 8)} finish=${abortedMessage.finish}`)
  console.log(`[test] aborted partial text length=${abortedText.length}`)
  if (abortedText.length > 0) {
    console.log(`[test] aborted text preview: "${abortedText.slice(0, 80).replace(/\n/g, " ")}..."`)
  }

  // 4. Send a follow-up prompt on the same session
  const followUp = "What was the exact wording of my first message to you? Reply verbatim."
  console.log(`\nUser: ${followUp}`)

  const secondResult = await runner.prompt({
    sessionId: firstSessionId,
    parts: [{ type: "text", text: followUp }],
    model: MODEL,
  })

  console.log(`[test] second prompt completed, sessionId=${secondResult.sessionId.slice(0, 8)}`)

  // 5. Verify toModelMessages does not include the aborted turn
  const { messages: finalMessages, parts: finalParts } = loadMessages(secondResult.sessionId, runner.store)
  const modelMessages = toModelMessages(finalMessages, finalParts)

  const serialized = JSON.stringify(modelMessages)
  if (abortedText.length > 0 && serialized.includes(abortedText)) {
    console.error("[FAIL] aborted partial text leaked into follow-up model context")
    process.exit(1)
  }

  const abortedIds = new Set(finalMessages.filter((m) => m.finish === "aborted").map((m) => m.id))
  const usedInContext = modelMessages.some((m) => {
    if (m.role !== "assistant") return false
    const content = m.content
    if (typeof content === "string") return false
    return (content as any[]).some((p) => p.messageId && abortedIds.has(p.messageId))
  })

  if (usedInContext) {
    console.error("[FAIL] aborted message parts were included in model context")
    process.exit(1)
  }

  console.log("\n[PASS] aborted message was correctly excluded from follow-up context")
  console.log(`       total messages=${finalMessages.length}, model context messages=${modelMessages.length}`)
  console.log("=== Done ===")
}

main().catch((err) => {
  console.error("E2E abort test failed:", err)
  process.exit(1)
})
