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

## Key findings

[Document any important findings, decisions, or insights from the conversation that should be remembered — e.g. root causes identified, trade-offs considered, approaches rejected and why.]
---`

// ---------------------------------------------------------------------------
// shouldCompact — estimate current prompt size, compare against model limit
//
// Uses chars/4 heuristic on system prompt + current modelMessages.
// Triggers when estimated tokens >= threshold * context_window.
//
// threshold comes from config.compact.threshold (default 0.50).
// context_window is resolved from models.dev (modelLimit) or
// config.context_window as fallback.
// ---------------------------------------------------------------------------
/**
 * Determine whether compaction should be triggered for the current session.
 *
 * Uses a `chars / 4` heuristic to estimate the token count of the system prompt
 * and all model messages. Triggers when `estimated >= threshold × contextWindow`.
 *
 * @param system - The current system prompt (string or array of strings)
 * @param modelMessages - The current model message array
 * @param modelLimit - Per-model limits from `models.dev` (or `null` if unavailable)
 * @param contextWindow - Fallback context window size from config (tokens)
 * @param threshold - Trigger threshold fraction (default `0.50`)
 * @returns `true` if compaction should be triggered
 */
export function shouldCompact(
  system: string | string[],
  modelMessages: import("ai").ModelMessage[],
  modelLimit: { context: number; input?: number; output: number } | null,
  contextWindow: number,
  threshold: number,
): boolean {
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  const estimated = estimateTokens(systemStr, modelMessages)
  const limit = getContextWindow(modelLimit, contextWindow)
  return estimated >= limit * threshold
}

/**
 * Check if the context window is at or above 100% capacity.
 *
 * Unlike `shouldCompact` which uses a configurable threshold (e.g. 50%),
 * this function checks if the context is completely full — used to block
 * new user messages when there is no room left.
 *
 * @param system - The current system prompt (string or array of strings)
 * @param modelMessages - The current model message array
 * @param modelLimit - Per-model limits from `models.dev` (or `null` if unavailable)
 * @param contextWindow - Fallback context window size from config (tokens)
 * @returns `true` if estimated tokens >= context window
 */
export function isContextFull(
  system: string | string[],
  modelMessages: import("ai").ModelMessage[],
  modelLimit: { context: number; input?: number; output: number } | null,
  contextWindow: number,
): boolean {
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  const estimated = estimateTokens(systemStr, modelMessages)
  const limit = getContextWindow(modelLimit, contextWindow)
  return estimated >= limit
}

// ---------------------------------------------------------------------------
// estimateTokens — chars/4 heuristic on the content that will be sent
// ---------------------------------------------------------------------------
/**
 * Estimate the token count for a system prompt + model messages using the `chars / 4` heuristic.
 *
 * @param system - System prompt string
 * @param modelMessages - Current model message array
 * @returns Estimated token count
 */
export function estimateTokens(
  system: string,
  modelMessages: import("ai").ModelMessage[],
): number {
  let chars = system.length

  for (const msg of modelMessages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && typeof part.text === "string") {
          chars += part.text.length
        } else if ("input" in part) {
          chars += JSON.stringify(part.input).length
        }
        if ("output" in part && part.output && typeof part.output === "object") {
          const out = part.output as Record<string, unknown>
          if (typeof out.value === "string") chars += out.value.length
        }
      }
    }
  }

  return Math.ceil(chars / 4)
}

// ---------------------------------------------------------------------------
// getContextWindow — resolve the context window size (tokens)
//
// Prefers the per-model limit from models.dev. Falls back to the
// user-configured context_window from config.yaml.
// ---------------------------------------------------------------------------
export function getContextWindow(
  modelLimit: { context: number; input?: number; output: number } | null,
  fallback: number,
): number {
  if (modelLimit) {
    // Prefer `input` (max prompt tokens) over `context` (total window incl. output)
    if (modelLimit.input && modelLimit.input > 0) return modelLimit.input
    if (modelLimit.context > 0) return modelLimit.context
  }
  return fallback
}

// ---------------------------------------------------------------------------
// getTotalTokens — sum up token usage from step-finish parts (kept for stats)
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
// isOverContextThreshold — pure helper for percentage comparison
//
// Centralises the `inputTokens >= threshold × contextWindow` check used by
// the pre-call compaction gate and the mid-stream overflow detection.
// ---------------------------------------------------------------------------
/**
 * Check if the given input token count exceeds the threshold fraction of the context window.
 *
 * @param inputTokens - Actual or estimated input token count
 * @param contextWindow - Total context window size in tokens
 * @param threshold - Fraction (0–1) at which compaction triggers
 * @returns `true` if `inputTokens >= threshold × contextWindow`
 */
export function isOverContextThreshold(
  inputTokens: number,
  contextWindow: number,
  threshold: number,
): boolean {
  return inputTokens >= contextWindow * threshold
}

// ---------------------------------------------------------------------------
// shouldCompactWithRealTokens — prefer real token count, fall back to estimate
//
// When step-finish parts exist, the last one's input token count is the best
// measure of context-window usage.  Only falls back to the chars/4 estimate
// when no step-finish data is available (first turn of a session).
// ---------------------------------------------------------------------------
/**
 * Decide whether compaction should trigger, using the provider-reported token
 * count from the most recent step-finish when available.
 *
 * Falls back to the `chars/4` estimate (via {@link shouldCompact}) only when
 * no step-finish parts exist (e.g. the very first turn before any LLM call).
 *
 * @param system - Current system prompt
 * @param modelMessages - Current model message array
 * @param modelLimit - Per-model limits from models.dev (or null)
 * @param contextWindow - Fallback context window size from config
 * @param threshold - Trigger threshold fraction
 * @param parts - All part rows for the current session (to find step-finish)
 * @returns `true` if compaction should be triggered
 */
export function shouldCompactWithRealTokens(
  system: string | string[],
  modelMessages: import("ai").ModelMessage[],
  modelLimit: { context: number; input?: number; output: number } | null,
  contextWindow: number,
  threshold: number,
  parts: PartRow[],
): boolean {
  const realTokens = getLastInputTokens(parts)
  if (realTokens > 0) {
    const limit = getContextWindow(modelLimit, contextWindow)
    return isOverContextThreshold(realTokens, limit, threshold)
  }
  // No step-finish data yet — fall back to chars/4 estimate
  return shouldCompact(system, modelMessages, modelLimit, contextWindow, threshold)
}

// ---------------------------------------------------------------------------
// getLastInputTokens — read the last step-finish's input token count
//
// This is the actual context-window usage at the end of the session's last
// API call.  Used to restore the token-% bar when switching to / resuming
// an existing session.
// ---------------------------------------------------------------------------
export function getLastInputTokens(parts: PartRow[]): number {
  let last = 0
  for (const p of parts) {
    if (p.type !== "step-finish") continue
    try {
      const data = JSON.parse(p.data) as StepFinishData
      if (data.tokens?.input !== undefined) {
        last = data.tokens.input
      }
    } catch {
      // skip malformed parts
    }
  }
  return last
}

// ---------------------------------------------------------------------------
// compact — summarize the conversation and save as a summary message
// ---------------------------------------------------------------------------
/**
 * Summarize the conversation and persist the summary as a special `"summary"` message part.
 *
 * Sends all current messages plus a compaction prompt to the LLM using `generateText`,
 * then saves the resulting summary. Used by the anchored compaction method.
 *
 * @param input.sessionId - The session to compact
 * @param input.model - The language model to use for summarization
 * @param input.abort - AbortSignal to cancel the operation
 */
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

  finishMessage(msg.id, "stop", undefined, input.sessionId)
}
