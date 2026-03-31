// Anchored compaction — alternate CompactMethodDef
//
// Strategy: split messages into evicted (old) and retained (recent N turns).
// Summarize the evicted span, merge into a persistent anchor.
// The anchor grows incrementally — new summaries merge into the existing one.
//
// NEW-SESSION DESIGN: Instead of writing an anchor back into the same session,
// this method creates a brand-new session seeded with the summary + retained
// turns, then returns { type: "new-session", newSessionId } so callers switch.
//
// Key optimization: prune tool outputs from the evicted span before sending
// to the LLM. Tool results are the biggest token hogs and the LLM only needs
// tool names + a high-level sense of what happened.

import { generateText, type ModelMessage } from "ai"
import type {
  CompactMethodDef,
  CompactMethodContext,
  CompactResult,
} from "../compact-resolver"
import { loadConfig } from "../../config/config"
import type { MessageRow, PartRow, ToolPartData, SummaryData } from "../message"

// ---------------------------------------------------------------------------
// Default compaction prompt template
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT = `Summarize the conversation so far for continuing our work.
Focus on information needed to continue effectively.

Use this template:
---
## Goal
[What goal(s) is the user trying to accomplish?]

## Instructions
- [Important instructions the user gave]
- [Any plan or spec details]

## Discoveries
[Notable things learned during this conversation]

## Accomplished
[What's done, what's in progress, what's left]

## Relevant files / directories
[Structured list of files read, edited, or created]
---`

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  retain_turns: 4,
  prompt: DEFAULT_PROMPT,
}

// ---------------------------------------------------------------------------
// AnchorData — extends SummaryData with a cutoff marker
// ---------------------------------------------------------------------------

export interface AnchorData {
  text: string
  compactedUntilMessageId: string
}

// ---------------------------------------------------------------------------
// anchored — the CompactMethodDef
// ---------------------------------------------------------------------------

export const anchored: CompactMethodDef = {
  id: "anchored",
  description: "Anchored iterative compaction — summarize old messages, create new session seeded with summary + retained turns",
  parameters: {
    retain_turns: {
      type: "number",
      description: "Number of recent user/assistant turn pairs to keep verbatim",
      default: DEFAULTS.retain_turns,
    },
    prompt: {
      type: "string",
      description: "Prompt template for the summarization LLM call",
      default: DEFAULTS.prompt,
    },
    custom_instructions: {
      type: "string",
      description: "Additional instructions appended to the compaction prompt",
      required: false,
    },
  },

  async execute(ctx: CompactMethodContext): Promise<CompactResult> {
    const config = loadConfig()
    const retainTurns = config.compact.retain_turns
    const prompt = DEFAULTS.prompt

    // Step 1: Split messages into evicted and retained
    const { evicted, retained } = splitMessages(ctx.messages, retainTurns)

    if (evicted.length === 0) {
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: 0 }
    }

    // Step 2: Build model messages from evicted span, pruning tool outputs
    const evictedParts = ctx.parts.filter((p) =>
      evicted.some((m) => m.id === p.messageId),
    )
    const prunedMessages = buildPrunedMessages(evicted, evictedParts)

    if (prunedMessages.length === 0) {
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: 0 }
    }

    // Step 3: Check for existing anchor — include it in the prompt for merging
    const existingAnchor = findExistingAnchor(ctx.messages, ctx.parts)
    const mergeInstruction = existingAnchor
      ? `\n\nPrevious summary to merge with (incorporate and update, don't discard):\n${existingAnchor.text}`
      : ""

    // Step 4: Send evicted span + prompt to model
    const result = await generateText({
      model: ctx.model,
      messages: [
        ...prunedMessages,
        { role: "user", content: prompt + mergeInstruction },
      ],
      maxRetries: 1,
    })

    const summaryText = result.text
    if (!summaryText) {
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: evicted.length }
    }

    // Step 5: Create a new session seeded with summary + retained turns
    const newSession = ctx.session.create()
    const newSid = newSession.id

    // 5a. Inject summary as the first user message
    ctx.persist.saveUserMessage({ sessionId: newSid, text: summaryText })

    // 5b. Copy each retained message into the new session
    const retainedParts = ctx.parts.filter((p) =>
      retained.some((m) => m.id === p.messageId),
    )
    const partsByMsg = new Map<string, PartRow[]>()
    for (const p of retainedParts) {
      const list = partsByMsg.get(p.messageId) ?? []
      list.push(p)
      partsByMsg.set(p.messageId, list)
    }

    for (const msg of retained) {
      if (msg.providerId === "compaction") continue

      const msgParts = partsByMsg.get(msg.id) ?? []

      if (msg.role === "user") {
        const texts: string[] = []
        for (const p of msgParts) {
          if (p.type === "text") {
            const d = JSON.parse(p.data) as { text: string }
            if (d.text) texts.push(d.text)
          }
        }
        if (texts.length > 0) {
          ctx.persist.saveUserMessage({ sessionId: newSid, text: texts.join("\n") })
        }
      } else {
        // Assistant — re-create the message with all parts
        const newMsg = ctx.persist.createMessage({
          sessionId: newSid,
          modelId: msg.modelId ?? undefined,
          providerId: msg.providerId ?? undefined,
        })
        for (const p of msgParts) {
          if (p.type === "text" || p.type === "summary") {
            const data = JSON.parse(p.data)
            ctx.persist.addPart({
              messageId: newMsg.id,
              sessionId: newSid,
              type: p.type as "text" | "summary",
              data,
            })
          } else if (p.type === "tool") {
            // Prune tool output to reduce token count in retained messages
            const toolData = JSON.parse(p.data) as ToolPartData
            const prunedData: ToolPartData = {
              ...toolData,
              output: toolData.status === "completed" || toolData.status === "error"
                ? "[output pruned for compaction]"
                : toolData.output,
            }
            ctx.persist.addPart({
              messageId: newMsg.id,
              sessionId: newSid,
              type: "tool",
              data: prunedData,
            })
          }
        }
        ctx.persist.finishMessage(newMsg.id, msg.finish ?? "stop", undefined, newSid)
      }
    }

    return {
      type: "new-session",
      newSessionId: newSid,
      summary: summaryText,
      evictedCount: evicted.length,
    }
  },
}

// ---------------------------------------------------------------------------
// splitMessages — divide into evicted (old) and retained (recent N turns)
//
// A "turn" is a user message + the assistant response that follows it.
// We count turns from the end and keep the last N turns intact.
// ---------------------------------------------------------------------------

export function splitMessages(
  messages: MessageRow[],
  retainTurns: number,
): { evicted: MessageRow[]; retained: MessageRow[] } {
  if (retainTurns <= 0 || messages.length === 0) {
    return { evicted: [...messages], retained: [] }
  }

  // Count turns from the end. A turn starts with a user message.
  let turnCount = 0
  let splitIdx = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    // Skip compaction messages — they're anchors, not real turns
    if (msg.providerId === "compaction") continue

    if (msg.role === "user") {
      turnCount++
      if (turnCount >= retainTurns) {
        splitIdx = i
        break
      }
    }
  }

  // If we didn't find enough turns, keep everything
  if (turnCount < retainTurns) {
    return { evicted: [], retained: [...messages] }
  }

  return {
    evicted: messages.slice(0, splitIdx),
    retained: messages.slice(splitIdx),
  }
}

// ---------------------------------------------------------------------------
// buildPrunedMessages — convert evicted messages to ModelMessage[],
// stripping tool outputs (biggest token savings)
// ---------------------------------------------------------------------------

export function buildPrunedMessages(
  messages: MessageRow[],
  parts: PartRow[],
): ModelMessage[] {
  const partsByMsg = new Map<string, PartRow[]>()
  for (const p of parts) {
    const list = partsByMsg.get(p.messageId) ?? []
    list.push(p)
    partsByMsg.set(p.messageId, list)
  }

  const result: ModelMessage[] = []

  for (const msg of messages) {
    // Skip compaction anchor messages — they'll be merged separately
    if (msg.providerId === "compaction") continue

    const msgParts = partsByMsg.get(msg.id) ?? []

    if (msg.role === "user") {
      const texts: string[] = []
      for (const p of msgParts) {
        if (p.type === "text") {
          const d = JSON.parse(p.data) as { text: string }
          texts.push(d.text)
        }
      }
      if (texts.length > 0) {
        result.push({ role: "user", content: texts.join("\n") })
      }
      continue
    }

    // Assistant — keep text and tool call names, but prune tool outputs
    const assistantContent: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = []
    const toolResults: Array<{
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: { type: "text"; value: string }
    }> = []

    for (const p of msgParts) {
      if (p.type === "text") {
        const d = JSON.parse(p.data) as { text: string }
        if (d.text) assistantContent.push({ type: "text", text: d.text })
      } else if (p.type === "tool") {
        const d = JSON.parse(p.data) as ToolPartData
        // Keep the tool call (name + input summary)
        assistantContent.push({
          type: "tool-call",
          toolCallId: d.callId,
          toolName: d.tool,
          input: d.input,
        })
        // Prune output — replace with a short marker
        if (d.status === "completed" || d.status === "error") {
          toolResults.push({
            type: "tool-result",
            toolCallId: d.callId,
            toolName: d.tool,
            output: {
              type: "text",
              value: d.error ? `Error: ${d.error}` : "[output pruned for compaction]",
            },
          })
        }
      }
    }

    if (assistantContent.length > 0) {
      result.push({ role: "assistant", content: assistantContent })
    }
    if (toolResults.length > 0) {
      result.push({ role: "tool", content: toolResults })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// findExistingAnchor — find the most recent anchor summary in messages
// ---------------------------------------------------------------------------

export function findExistingAnchor(
  messages: MessageRow[],
  parts: PartRow[],
): AnchorData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.providerId !== "compaction") continue

    const msgParts = parts.filter((p) => p.messageId === msg.id)
    const summaryPart = msgParts.find((p) => p.type === "summary")
    if (summaryPart) {
      const data = JSON.parse(summaryPart.data) as AnchorData
      if (data.text && data.compactedUntilMessageId) return data
    }
  }
  return null
}
