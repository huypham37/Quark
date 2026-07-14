import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCodexConsumer } from "../../src/provider/codex-consumer"
import { createAssistantMessage, loadMessages, type StepFinishData } from "../../src/session/message"
import { processStream } from "../../src/session/processor"
import type { ResolvedModel } from "../../src/provider/resolver"
import { createSession } from "../../src/session/session"
import { ensureStorageRoot } from "../../src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../src/storage/session-path"

let storageRoot: string

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "quark-test-processor-usage-"))
  setSessionStorageRoot(storageRoot)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
})

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

describe("processor usage persistence", () => {
  test("persists real stream usage on both the step and completed message", async () => {
    const model = createCodexConsumer({
      modelId: "gpt-5.5",
      jwt: "test-jwt",
      accountId: "test-account",
      fetch: async () => sseResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "msg_output", type: "message" },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          item_id: "msg_output",
          delta: "done",
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "msg_output", type: "message" },
        },
        {
          type: "response.completed",
          response: { usage: { input_tokens: 12, output_tokens: 5 } },
        },
      ]),
    })
    const session = createSession()
    const message = createAssistantMessage({
      sessionId: session.id,
      providerId: "codex",
      modelId: "gpt-5.5",
    })

    const resolvedModel = {
      languageModel: model,
      ref: { providerId: "codex", modelId: "gpt-5.5", spec: "codex/gpt-5.5" },
      descriptor: {
        providerId: "codex", modelId: "gpt-5.5", spec: "codex/gpt-5.5",
        limits: null, capabilities: {}, pricing: { kind: "subscription" }, available: "unknown",
      },
      pricingSnapshot: { kind: "subscription" },
      providerOptionsKey: "openai",
      provider: {} as any,
    } satisfies ResolvedModel
    const result = await processStream({
      model,
      resolvedModel,
      system: [],
      messages: [{ role: "user", content: "test" }],
      tools: {},
      abort: new AbortController().signal,
      msg: message,
      sessionId: session.id,
      providerId: "codex",
      modelId: "gpt-5.5",
    })

    expect(result).toBe("stop")

    const persisted = loadMessages(session.id)
    const completed = persisted.messages.find((candidate) => candidate.id === message.id)
    const step = persisted.parts.find(
      (part) => part.messageId === message.id && part.type === "step-finish",
    )
    const stepData = JSON.parse(step!.data) as StepFinishData

    expect(stepData.tokens).toMatchObject({
      input: 12,
      inputNoCache: 12,
      output: 5,
      outputText: 5,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(stepData.model).toEqual({ providerId: "codex", modelId: "gpt-5.5", spec: "codex/gpt-5.5" })
    expect(stepData.charge).toEqual({ kind: "subscription" })
    expect(completed?.tokensIn).toBe(12)
    expect(completed?.tokensOut).toBe(5)
  })
})
