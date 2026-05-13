// Stream event handler — consume LLM stream, persist parts, emit events
//
// Calls streamText() and iterates over fullStream events:
// - text-start/delta/end → persist text parts + emit to bus
// - tool-input-start/delta/end + tool-call → persist tool parts + emit
// - tool-result/tool-error → update tool parts with output + emit
// - start-step/finish-step → persist step metadata + emit
// - error → check retryable, throw otherwise
//
// Returns "continue" if the last finish reason was "tool-calls" (so the
// agent loop re-invokes the LLM), or "stop" otherwise.

import { streamText, type ModelMessage, type LanguageModel, type ToolSet } from "ai"
import { generateId } from "ai"
import type { JSONObject } from "@ai-sdk/provider"
import {
  addPart,
  updatePart,
  finishMessage,
  type MessageRow,
  type TextPartData,
  type ToolPartData,
  type StepFinishData,
  type ReasoningPartData,
} from "./message"
import { isRetryable, isContextTooLong, retryDelay, extractRetryAfter, sleep } from "./retry"
import { isOverContextThreshold, getContextWindow } from "./context"
import { bus } from "./events"
import { fireHook } from "../plugin/registry"
import { loadConfig } from "../config/config"
import { getModelLimit } from "../provider/models"
import { debug } from "../debug"
import { generateUnifiedDiff } from "../shared/diff-utils"
import * as fs from "fs"

const dlog = debug("processor")

export interface ProcessInput {
  model: LanguageModel
  system: string[]
  messages: ModelMessage[]
  tools: ToolSet
  abort: AbortSignal
  msg: MessageRow
  sessionId: string
  maxOutputTokens?: number
  /** Provider ID for plugin hooks (e.g. "copilot", "ollama") */
  providerId?: string
  /** Model ID for plugin hooks (e.g. "claude-sonnet-4.6") */
  modelId?: string
  /** Provider-specific options (e.g. thinking budget for Anthropic) */
  providerOptions?: Record<string, JSONObject>
  /**
   * Optional callback so provider.request.error plugins can switch provider/model
   * without creating a circular import between processor and prompt.
   */
  rebuildModel?: (provider: string, model: string) => Promise<LanguageModel>
}

export async function processStream(input: ProcessInput): Promise<"stop" | "continue" | "branch"> {
  // Track tool parts by callId so we can update them as events arrive
  const toolParts = new Map<string, { partId: string; data: ToolPartData }>()
  let currentText: { partId: string; data: TextPartData } | undefined
  let currentReasoning: { partId: string; data: ReasoningPartData } | undefined
  let lastFinish: string | undefined
  let needsBranch = false
  let attempt = 0
  const maxRetries = 5

  const sid = input.sessionId
  const mid = input.msg.id

  while (true) {
    try {
      const result = streamText({
        model: input.model,
        messages: [
          ...input.system.map(
            (s): ModelMessage => ({ role: "system", content: s }),
          ),
          ...input.messages,
        ],
        tools: input.tools,
        abortSignal: input.abort,
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 0,
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      })

      for await (const event of result.fullStream) {
        input.abort.throwIfAborted()

        if (dlog.enabled) {
          dlog("event:", event.type, event.type === "finish-step" ? `(reason=${(event as any).finishReason})` : "")
        }

        switch (event.type) {
          case "start":
            break

          case "text-start": {
            const data: TextPartData = { text: "" }
            const partId = addPart({
              messageId: mid,
              sessionId: sid,
              type: "text",
              data,
            })
            currentText = { partId, data }
            bus.emit("text-start", { sessionId: sid, messageId: mid, partId })
            break
          }

          case "text-delta": {
            if (currentText) {
              currentText.data.text += event.text
              bus.emit("text-delta", {
                sessionId: sid,
                messageId: mid,
                partId: currentText.partId,
                delta: event.text,
                text: currentText.data.text,
              })
            }
            break
          }

          case "text-end": {
            if (currentText) {
              currentText.data.text = currentText.data.text.trimEnd()
              updatePart(currentText.partId, currentText.data, sid, mid, "text")
              bus.emit("text-end", {
                sessionId: sid,
                messageId: mid,
                partId: currentText.partId,
                text: currentText.data.text,
              })
              currentText = undefined
            }
            break
          }

          case "tool-input-start": {
            // Create a pending tool part
            const data: ToolPartData = {
              tool: event.toolName,
              callId: event.id,
              status: "pending",
              input: {},
            }
            const partId = addPart({
              messageId: mid,
              sessionId: sid,
              type: "tool",
              data,
            })
            toolParts.set(event.id, { partId, data })
            bus.emit("tool-start", {
              sessionId: sid,
              messageId: mid,
              partId,
              tool: event.toolName,
              callId: event.id,
            })
            break
          }

          case "tool-input-delta":
            // Streaming input text — we wait for tool-call for final args
            break

          case "tool-input-end":
            break

          case "tool-call": {
            const match = toolParts.get(event.toolCallId)
            if (match) {
              match.data.status = "awaiting_approval"
              match.data.input = event.input as Record<string, unknown>
              match.data.tool = event.toolName

              // Compute preview diff for write/edit tools (read-only)
              const previewDiff = computePreviewDiff(event.toolName, match.data.input)

              updatePart(match.partId, match.data, sid, mid, "tool")
              bus.emit("tool-input", {
                sessionId: sid,
                messageId: mid,
                partId: match.partId,
                tool: event.toolName,
                callId: event.toolCallId,
                input: match.data.input,
                diff: previewDiff,
              })
            }
            break
          }

          case "tool-result": {
            const match = toolParts.get(event.toolCallId)
            if (match) {
              match.data.status = "completed"
              match.data.input = (event.input as Record<string, unknown>) ?? match.data.input
              // Extract output text from the tool result
              const out = event.output as any
              match.data.output = extractOutput(out)
              // Store multi-modal content parts if the output is an array
              const contentParts = extractContentParts(out)
              if (contentParts) {
                match.data.contentParts = contentParts
              }
              // Extract diff from metadata if present
              const diff = extractDiff(out)
              updatePart(match.partId, match.data, sid, mid, "tool")
              bus.emit("tool-end", {
                sessionId: sid,
                messageId: mid,
                partId: match.partId,
                tool: match.data.tool,
                callId: event.toolCallId,
                status: "completed",
                output: match.data.output,
                diff,
              })
              toolParts.delete(event.toolCallId)
            }
            break
          }

          case "tool-error": {
            const match = toolParts.get(event.toolCallId)
            if (match) {
              match.data.status = "error"
              match.data.input = (event.input as Record<string, unknown>) ?? match.data.input
              match.data.error = String(event.error)
              updatePart(match.partId, match.data, sid, mid, "tool")
              bus.emit("tool-end", {
                sessionId: sid,
                messageId: mid,
                partId: match.partId,
                tool: match.data.tool,
                callId: event.toolCallId,
                status: "error",
                error: match.data.error,
              })
              toolParts.delete(event.toolCallId)
            }
            break
          }

          case "start-step": {
            addPart({
              messageId: mid,
              sessionId: sid,
              type: "step-start",
              data: {},
            })
            bus.emit("step-start", { sessionId: sid, messageId: mid })
            break
          }

          case "finish-step": {
            lastFinish = event.finishReason
            const usage = event.usage
            const stepData: StepFinishData = {
              reason: event.finishReason,
              tokens: {
                input:      usage?.inputTokens,
                output:     usage?.outputTokens,
                cacheRead:  usage?.inputTokenDetails?.cacheReadTokens,
                cacheWrite: usage?.inputTokenDetails?.cacheWriteTokens,
              },
            }
            addPart({
              messageId: mid,
              sessionId: sid,
              type: "step-finish",
              data: stepData,
            })
            bus.emit("step-finish", { sessionId: sid, messageId: mid, data: stepData })

            // Mid-stream overflow check: if the input tokens from this step
            // exceed the branching threshold, stop before the next tool round.
            if (!needsBranch && usage?.inputTokens) {
              const cfg = loadConfig()
              if (cfg.branching.auto) {
                const modelLimit = getModelLimit(input.modelId ?? "")
                const ctxWindow = getContextWindow(modelLimit)

                if (ctxWindow > 0 && isOverContextThreshold(usage.inputTokens, ctxWindow, cfg.branching.threshold)) {
                  needsBranch = true
                }
              }
            }
            break
          }

          case "error": {
            // Responses API via Copilot emits non-fatal "text part <id> not found"
            // errors interleaved with valid output. These are SDK parsing artifacts
            // from opaque Copilot part IDs — safe to ignore.
            const errMsg = String(event.error)
            if (/text part .+ not found/.test(errMsg)) break
            throw event.error
          }

          case "finish":
            break

          // reasoning events — persist and emit to bus for TUI rendering
          case "reasoning-start": {
            const data: ReasoningPartData = { text: "" }
            const partId = addPart({
              messageId: mid,
              sessionId: sid,
              type: "reasoning",
              data,
            })
            currentReasoning = { partId, data }
            bus.emit("reasoning-start", { sessionId: sid, messageId: mid, partId })
            break
          }

          case "reasoning-delta": {
            if (currentReasoning) {
              currentReasoning.data.text += event.text
              bus.emit("reasoning-delta", {
                sessionId: sid,
                messageId: mid,
                partId: currentReasoning.partId,
                delta: event.text,
                text: currentReasoning.data.text,
              })
            }
            break
          }

          case "reasoning-end": {
            if (currentReasoning) {
              updatePart(currentReasoning.partId, currentReasoning.data, sid, mid, "reasoning")
              bus.emit("reasoning-end", {
                sessionId: sid,
                messageId: mid,
                partId: currentReasoning.partId,
              })
              currentReasoning = undefined
            }
            break
          }

          default:
            break
        }

        // Mid-stream branching: if finish-step set needsBranch, stop
        // consuming the stream before the next tool round begins.
        if (needsBranch) break
      }
    } catch (e: any) {
      // Mark any in-flight tool parts as errored and notify the TUI via bus
      for (const [callId, entry] of toolParts) {
        if (entry.data.status === "pending" || entry.data.status === "awaiting_approval" || entry.data.status === "running") {
          entry.data.status = "error"
          entry.data.error = "Tool execution aborted"
          updatePart(entry.partId, entry.data, sid, mid, "tool")
          bus.emit("tool-end", {
            sessionId: sid,
            messageId: mid,
            partId: entry.partId,
            tool: entry.data.tool,
            callId,
            status: "error",
            error: entry.data.error,
          })
        }
      }
      toolParts.clear()

      // Flush any in-progress text
      if (currentText) {
        currentText.data.text = currentText.data.text.trimEnd()
        updatePart(currentText.partId, currentText.data, sid, mid, "text")
        currentText = undefined
      }

      // Context-too-long: signal the loop to branch instead of crashing
      if (isContextTooLong(e)) {
        finishMessage(mid, "stop", undefined, sid)
        bus.emit("context-too-long", { sessionId: sid, error: e })
        return "branch"
      }

      if (isRetryable(e)) {
        const serverDelay = extractRetryAfter(e)

        // If the server says wait > 5 minutes (e.g. monthly quota reset), don't retry — surface it
        if (serverDelay !== undefined && serverDelay > 5 * 60 * 1000) {
          finishMessage(mid, "stop", undefined, sid)
          bus.emit("error", { sessionId: sid, error: e })
          throw e
        }

        if (attempt >= maxRetries) {
          finishMessage(mid, "stop", undefined, sid)
          bus.emit("error", { sessionId: sid, error: e })
          throw e
        }
        attempt++
        const delay = serverDelay ?? retryDelay(attempt)
        bus.emit("retry", { sessionId: sid, attempt, delayMs: delay, error: e })
        await sleep(delay, input.abort).catch(() => {})
        if (input.abort.aborted) break
        continue
      }

      // Plugin hook: provider request error — plugins can request a retry with a new provider/model
      const hookOutput = await fireHook("provider.request.error", {
        provider: input.providerId ?? "unknown",
        model: input.modelId ?? "unknown",
        error: e,
        statusCode: (e as any)?.status,
      })
      if (hookOutput.retry) {
        // If the plugin wants to switch provider/model, rebuild the model
        if ((hookOutput.provider || hookOutput.model) && input.rebuildModel) {
          const newProvider = hookOutput.provider ?? input.providerId ?? "unknown"
          const newModel = hookOutput.model ?? input.modelId ?? "unknown"
          input.model = await input.rebuildModel(newProvider, newModel)
        }
        attempt++
        const delay = retryDelay(attempt)
        await sleep(delay, input.abort).catch(() => {})
        if (input.abort.aborted) break
        continue
      }

      // Update the message with error state
      finishMessage(mid, "stop", undefined, sid)
      bus.emit("error", { sessionId: sid, error: e })
      throw e
    }

    // Success path — finalize the message
    // Mid-stream branching: if we broke out of the stream because of overflow,
    // finalize the current message and signal the loop to branch.
    if (needsBranch) {
      finishMessage(mid, "stop", undefined, sid)
      bus.emit("assistant-message-end", { sessionId: sid, messageId: mid, finish: "stop" })
      return "branch"
    }

    const finish = lastFinish === "tool-calls" ? "tool-calls" as const
      : lastFinish === "length" ? "length" as const
      : "stop" as const

    // Accumulate total usage from step-finish parts
    finishMessage(mid, finish, undefined, sid)
    bus.emit("assistant-message-end", { sessionId: sid, messageId: mid, finish })

    dlog(`stream finished: lastFinish=${lastFinish} → returning ${finish === "tool-calls" ? "continue" : "stop"}`)

    if (finish === "tool-calls") return "continue"
    return "stop"
  }

  // Should not reach here, but if abort breaks the retry loop
  finishMessage(mid, "stop", undefined, sid)
  return "stop"
}

// Compute a read-only preview diff for write/edit tools during tool-call.
// This runs BEFORE the tool executes, so the diff is available in the TUI
// alongside the permission prompt. Uses pure-JS Myers diff (no shell out).
function computePreviewDiff(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool !== "write" && tool !== "edit") return undefined

  const filePath = (input.filePath ?? input.path) as string | undefined
  if (!filePath) return undefined

  try {
    // Guard against large files (> 100KB)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath)
      if (stat.size > 100_000) return undefined
    }

    const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : ""

    let after: string
    if (tool === "write") {
      after = (input.content as string) ?? ""
    } else {
      // edit: approximate with exact-match replace (real tool has 3 strategies)
      const oldStr = ((input.old ?? input.oldString) as string) ?? ""
      const newStr = ((input.new ?? input.newString) as string) ?? ""
      if (!oldStr || !before) return undefined
      after = before.replace(oldStr, newStr)
      if (after === before) return undefined // no match found
    }

    return generateUnifiedDiff(before, after, filePath)
  } catch {
    return undefined // diff failure must not block the permission flow
  }
}

// Extract diff string from tool result metadata
function extractDiff(out: unknown): string | undefined {
  if (out && typeof out === "object") {
    const o = out as any
    if (typeof o.metadata?.diff === "string" && o.metadata.diff.length > 0) {
      return o.metadata.diff
    }
  }
  return undefined
}

// Extract string output from tool result (which may be various formats)
function extractOutput(out: unknown): string {
  if (typeof out === "string") return out
  if (out && typeof out === "object") {
    const o = out as any
    // AI SDK tool result shape: { output, title, metadata }
    if (Array.isArray(o.output)) {
      // Multi-modal content parts — extract text-only portions for the string field
      return o.output
        .filter((p: any) => p.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join(" ")
    }
    if (typeof o.output === "string") return o.output
    // LanguageModelV3ToolResultOutput shape
    if (o.type === "text" && typeof o.value === "string") return o.value
    return JSON.stringify(out)
  }
  return String(out ?? "")
}

// Extract content parts array from tool result when output is multi-modal
function extractContentParts(out: unknown): any[] | undefined {
  if (out && typeof out === "object") {
    const o = out as any
    if (Array.isArray(o.output)) return o.output
  }
  return undefined
}
