// General compaction — the default CompactMethodDef
//
// Strategy: keep N recent turns verbatim, strip ALL tool calls and results
// from the evicted span, send only user/assistant text to the LLM for a
// brief summary focused on: goal, file paths, immediate next step, and any
// referenced plan.
//
// NEW-SESSION DESIGN: Instead of writing an anchor back into the same session,
// this method:
//   1. Generates a summary of the evicted span
//   2. Creates a brand-new session
//   3. Seeds it with the summary as a user message followed by the retained turns
//   4. Returns { type: "new-session", newSessionId } so callers can switch
//
// The old session is left untouched as archived history.

import { generateText, type ModelMessage } from "ai"
import type {
  CompactMethodDef,
  CompactMethodContext,
  CompactResult,
} from "../compact-resolver"
import { loadConfig } from "../../config/config"
import type { MessageRow, PartRow, ToolPartData } from "../message"

// ---------------------------------------------------------------------------
// Compaction prompt — brief and focused
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT = `Summarize the conversation so far. Be brief and factual.

Use this template:
---
## Goal
[What the user is trying to accomplish — 1-2 sentences]

## Relevant files
[List file paths only, one per line, no descriptions]

## Next step
[The immediate next thing to do — 1-2 sentences]

## Plan
[If the session references a plan or spec, summarize it here. Otherwise omit this section.]
---`

// ---------------------------------------------------------------------------
// general — the CompactMethodDef
// ---------------------------------------------------------------------------

export const general: CompactMethodDef = {
  id: "general",
  description: "General compaction — brief summary, strips all tool calls, keeps goal/files/next step",
  parameters: {
    retain_turns: {
      type: "number",
      description: "Number of recent user/assistant turn pairs to keep verbatim",
      default: 5,
    },
    prompt: {
      type: "string",
      description: "Prompt template for the summarization LLM call",
      default: DEFAULT_PROMPT,
    },
  },

  async execute(ctx: CompactMethodContext): Promise<CompactResult> {
    const config = loadConfig()
    const retainTurns = config.compact.retain_turns
    console.log("[compact-general] execute start, retainTurns:", retainTurns, "total messages:", ctx.messages.length, "total parts:", ctx.parts.length)

    // Step 1: Split messages into evicted and retained using cascade
    // cascadeSplit tries retainTurns, retainTurns-1, …, 0 to always evict
    // something when there are messages to evict.
    const { evicted, retained } = cascadeSplit(ctx.messages, retainTurns)
    console.log("[compact-general] cascadeSplit: evicted:", evicted.length, "retained:", retained.length)

    if (evicted.length === 0) {
      console.log("[compact-general] nothing to evict, returning early")
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: 0 }
    }

    // Step 2: Build model messages from evicted span — text only, no tool calls
    const evictedParts = ctx.parts.filter((p) =>
      evicted.some((m) => m.id === p.messageId),
    )
    const textMessages = buildTextOnlyMessages(evicted, evictedParts)
    console.log("[compact-general] textMessages from evicted:", textMessages.length)

    if (textMessages.length === 0) {
      console.log("[compact-general] no text messages from evicted span, returning early")
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: 0 }
    }

    // Step 3: Check for existing anchor summary from a prior compaction in this
    // session — incorporate it so we don't lose previously summarised context
    const existingAnchor = findExistingAnchor(ctx.messages, ctx.parts)
    const mergeInstruction = existingAnchor
      ? `\n\nPrevious summary to incorporate and update (don't discard):\n${existingAnchor.text}`
      : ""
    console.log("[compact-general] existingAnchor:", existingAnchor ? "yes" : "no")

    // Step 4: Prune evicted text messages to fit the model's input budget.
    // Budget = model input window - output window - prompt overhead.
    // Drop oldest messages first until they fit.
    const inputLimit = ctx.budget?.input ?? ctx.budget?.context ?? 128_000
    const outputReserve = ctx.budget?.output ?? 64_000
    const promptOverhead = Math.ceil((DEFAULT_PROMPT.length + mergeInstruction.length) / 4) + 512
    const budget = Math.max(0, inputLimit - outputReserve - promptOverhead)
    const prunedMessages = pruneToTokenBudget(textMessages, budget)
    console.log("[compact-general] budget=%d pruned from %d to %d messages", budget, textMessages.length, prunedMessages.length)

    // Step 5: Send text-only evicted span + prompt to model
    console.log("[compact-general] calling generateText with", prunedMessages.length + 1, "messages")
    const result = await generateText({
      model: ctx.model,
      messages: [
        ...prunedMessages,
        { role: "user", content: DEFAULT_PROMPT + mergeInstruction },
      ],
      maxRetries: 1,
    })
    console.log("[compact-general] generateText returned, text length:", result.text?.length ?? 0)

    const summaryText = result.text
    if (!summaryText) {
      console.log("[compact-general] empty summary text, returning early")
      return { type: "new-session", newSessionId: ctx.sessionId, summary: "", evictedCount: evicted.length }
    }

    // Step 6: Create a new session and seed it with summary + retained turns
    console.log("[compact-general] creating new session...")
    const newSession = ctx.session.create()
    const newSid = newSession.id
    console.log("[compact-general] new session created:", newSid)

    // 5a. Inject summary as the first user message in the new session
    ctx.persist.saveUserMessage({ sessionId: newSid, text: summaryText })

    // 5b. Copy each retained message (user + assistant) into the new session.
    //     We re-create the DB rows using the same persist helpers the processor uses.
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
        // Collect all text parts and re-save as a single user message
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
        // Assistant message — re-create with all parts
        const newMsg = ctx.persist.createMessage({
          sessionId: newSid,
          modelId: msg.modelId ?? undefined,
          providerId: msg.providerId ?? undefined,
        })
        for (const p of msgParts) {
          if (p.type === "text" || p.type === "tool" || p.type === "summary") {
            const data = JSON.parse(p.data)
            ctx.persist.addPart({
              messageId: newMsg.id,
              sessionId: newSid,
              type: p.type as "text" | "tool" | "summary",
              data,
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
// AnchorData — used to detect prior compaction anchors within the session
// ---------------------------------------------------------------------------

export interface AnchorData {
  text: string
  compactedUntilMessageId: string
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

  let turnCount = 0
  let splitIdx = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.providerId === "compaction") continue

    if (msg.role === "user") {
      turnCount++
      if (turnCount >= retainTurns) {
        splitIdx = i
        break
      }
    }
  }

  if (turnCount < retainTurns) {
    return { evicted: [], retained: [...messages] }
  }

  return {
    evicted: messages.slice(0, splitIdx),
    retained: messages.slice(splitIdx),
  }
}

// ---------------------------------------------------------------------------
// cascadeSplit — try retainTurns, retainTurns-1, …, 0 until we can evict
//
// splitMessages returns evicted=[] when turns < retainTurns.  This wrapper
// cascades downward so compaction always evicts something when there are
// messages to evict.  Stops at the highest N that produces non-empty eviction.
// ---------------------------------------------------------------------------

export function cascadeSplit(
  messages: MessageRow[],
  retainTurns: number,
): { evicted: MessageRow[]; retained: MessageRow[] } {
  for (let n = retainTurns; n >= 0; n--) {
    const result = splitMessages(messages, n)
    if (result.evicted.length > 0) return result
  }
  return { evicted: [], retained: [] }
}

// ---------------------------------------------------------------------------
// buildTextOnlyMessages — extract only user and assistant text from evicted
// span. ALL tool calls and tool results are stripped entirely.
// ---------------------------------------------------------------------------

export function buildTextOnlyMessages(
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
    if (msg.providerId === "compaction") continue

    const msgParts = partsByMsg.get(msg.id) ?? []

    // Extract text parts only
    const texts: string[] = []
    for (const p of msgParts) {
      if (p.type === "text") {
        const d = JSON.parse(p.data) as { text: string }
        if (d.text) texts.push(d.text)
      }
    }

    if (texts.length > 0) {
      result.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: texts.join("\n"),
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// pruneToTokenBudget — drop oldest messages until estimated tokens fit budget
//
// Uses chars/4 heuristic. Drops from the front (oldest first) so the most
// recent context is always preserved for the summarization call.
// ---------------------------------------------------------------------------

export function pruneToTokenBudget(messages: ModelMessage[], budget: number): ModelMessage[] {
  const estimateContent = (content: ModelMessage["content"]): number => {
    if (typeof content === "string") return content.length
    if (Array.isArray(content)) {
      return content.reduce((sum, part) => {
        if ("text" in part && typeof part.text === "string") return sum + part.text.length
        if ("input" in part) return sum + JSON.stringify(part.input).length
        return sum
      }, 0)
    }
    return 0
  }

  const estimate = (msgs: ModelMessage[]) =>
    Math.ceil(msgs.reduce((sum, m) => sum + estimateContent(m.content), 0) / 4)

  let result = [...messages]
  while (result.length > 1 && estimate(result) > budget) {
    result.shift()
  }
  return result
}

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
