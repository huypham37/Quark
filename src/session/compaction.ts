// Context compaction — summarize old messages to reduce token usage
//
// When token usage exceeds the configured threshold, compact() is called:
// 1. Load all messages for the session
// 2. Send them to the LLM with a summarization prompt
// 3. Save the summary as a special assistant message with a "summary" part
// 4. toModelMessages() detects summary messages and trims history
//
// The summary replaces all prior context with a condensed version.

import { generateText, type LanguageModel } from "ai"
import {
  loadMessages,
  toModelMessages,
  createAssistantMessage,
  addPart,
  finishMessage,
  type StepFinishData,
  type PartRow,
} from "./message"

const COMPACTION_PROMPT = `Provide a detailed summary of the conversation so far for continuing our work.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give that are relevant]
- [If there is a plan or spec, include information about it]

## Discoveries

[What notable things were learned during this conversation that would be useful for continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand.]
---`

// ---------------------------------------------------------------------------
// shouldCompact — check if token usage exceeds model's context limit
//
// Uses per-model limits from models.dev when available.
// Falls back to config.context_limit_tokens.
// ---------------------------------------------------------------------------
export function shouldCompact(
  parts: PartRow[],
  modelLimit: { context: number; output: number } | null,
  fallbackThreshold: number,
): boolean {
  const usage = getTotalTokens(parts)

  if (modelLimit && modelLimit.context > 0) {
    const usable = modelLimit.context - modelLimit.output
    return usage.total >= usable
  }

  return usage.total > fallbackThreshold * 0.8
}

// ---------------------------------------------------------------------------
// getTotalTokens — sum up token usage from step-finish parts
// ---------------------------------------------------------------------------
export function getTotalTokens(parts: PartRow[]): {
  input: number
  output: number
  total: number
} {
  let input = 0
  let output = 0

  for (const p of parts) {
    if (p.type !== "step-finish") continue
    try {
      const data = JSON.parse(p.data) as StepFinishData
      input += data.tokens?.input ?? 0
      output += data.tokens?.output ?? 0
    } catch {
      // skip malformed parts
    }
  }

  return { input, output, total: input + output }
}

// ---------------------------------------------------------------------------
// compact — summarize the conversation and save as a summary message
// ---------------------------------------------------------------------------
export async function compact(input: {
  sessionId: string
  model: LanguageModel
  abort: AbortSignal
}): Promise<void> {
  const { messages, parts } = loadMessages(input.sessionId)
  const modelMessages = toModelMessages(messages, parts)

  if (modelMessages.length === 0) return

  // Create a summary by sending all messages + compaction prompt to the LLM
  const result = await generateText({
    model: input.model,
    messages: [
      ...modelMessages,
      { role: "user", content: COMPACTION_PROMPT },
    ],
    abortSignal: input.abort,
    maxRetries: 1,
  })

  const summaryText = result.text
  if (!summaryText) return

  // Save as a special assistant message with a "summary" part
  const msg = createAssistantMessage({
    sessionId: input.sessionId,
    modelId: "compaction",
    providerId: "compaction",
  })

  addPart({
    messageId: msg.id,
    sessionId: input.sessionId,
    type: "summary",
    data: { text: summaryText },
  })

  finishMessage(msg.id, "stop")
}
