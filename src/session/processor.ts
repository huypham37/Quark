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
import {
  addPart,
  updatePart,
  finishMessage,
  type MessageRow,
  type TextPartData,
  type ToolPartData,
  type StepFinishData,
} from "./message"
import { isRetryable, retryDelay, sleep } from "./retry"
import { bus } from "./events"

export interface ProcessInput {
  model: LanguageModel
  system: string[]
  messages: ModelMessage[]
  tools: ToolSet
  abort: AbortSignal
  msg: MessageRow
  sessionId: string
  maxOutputTokens?: number
}

export async function processStream(input: ProcessInput): Promise<"stop" | "continue"> {
  // Track tool parts by callId so we can update them as events arrive
  const toolParts = new Map<string, { partId: string; data: ToolPartData }>()
  let currentText: { partId: string; data: TextPartData } | undefined
  let lastFinish: string | undefined
  let attempt = 0

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
      })

      for await (const event of result.fullStream) {
        input.abort.throwIfAborted()

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
              updatePart(currentText.partId, currentText.data)
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
              match.data.status = "running"
              match.data.input = event.input as Record<string, unknown>
              match.data.tool = event.toolName
              updatePart(match.partId, match.data)
              bus.emit("tool-input", {
                sessionId: sid,
                messageId: mid,
                partId: match.partId,
                tool: event.toolName,
                callId: event.toolCallId,
                input: match.data.input,
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
              updatePart(match.partId, match.data)
              bus.emit("tool-end", {
                sessionId: sid,
                messageId: mid,
                partId: match.partId,
                tool: match.data.tool,
                callId: event.toolCallId,
                status: "completed",
                output: match.data.output,
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
              updatePart(match.partId, match.data)
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
                input: usage?.inputTokens,
                output: usage?.outputTokens,
              },
            }
            addPart({
              messageId: mid,
              sessionId: sid,
              type: "step-finish",
              data: stepData,
            })
            bus.emit("step-finish", { sessionId: sid, messageId: mid, data: stepData })
            break
          }

          case "error":
            throw event.error

          case "finish":
            break

          // reasoning events — skip for now (minimal agent)
          case "reasoning-start":
          case "reasoning-delta":
          case "reasoning-end":
            break

          default:
            break
        }
      }
    } catch (e: any) {
      // Mark any in-flight tool parts as errored
      for (const [, entry] of toolParts) {
        if (entry.data.status === "pending" || entry.data.status === "running") {
          entry.data.status = "error"
          entry.data.error = "Tool execution aborted"
          updatePart(entry.partId, entry.data)
        }
      }
      toolParts.clear()

      // Flush any in-progress text
      if (currentText) {
        currentText.data.text = currentText.data.text.trimEnd()
        updatePart(currentText.partId, currentText.data)
        currentText = undefined
      }

      if (isRetryable(e)) {
        attempt++
        const delay = retryDelay(attempt)
        await sleep(delay, input.abort).catch(() => {})
        if (input.abort.aborted) break
        continue
      }

      // Update the message with error state
      finishMessage(mid, "stop")
      bus.emit("error", { sessionId: sid, error: e })
      throw e
    }

    // Success path — finalize the message
    const finish = lastFinish === "tool-calls" ? "tool-calls" as const
      : lastFinish === "length" ? "length" as const
      : "stop" as const

    // Accumulate total usage from step-finish parts
    finishMessage(mid, finish)
    bus.emit("assistant-message-end", { sessionId: sid, messageId: mid, finish })

    if (finish === "tool-calls") return "continue"
    return "stop"
  }

  // Should not reach here, but if abort breaks the retry loop
  finishMessage(mid, "stop")
  return "stop"
}

// Extract string output from tool result (which may be various formats)
function extractOutput(out: unknown): string {
  if (typeof out === "string") return out
  if (out && typeof out === "object") {
    const o = out as any
    // AI SDK tool result shape: { output, title, metadata }
    if (typeof o.output === "string") return o.output
    // LanguageModelV3ToolResultOutput shape
    if (o.type === "text" && typeof o.value === "string") return o.value
    return JSON.stringify(out)
  }
  return String(out ?? "")
}
