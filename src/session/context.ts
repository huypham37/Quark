// Context window utilities — token estimation and threshold checking
//
// Extracted from the legacy compaction module. These are utility functions
// used by branching, the agent loop, and session switching.

import type { PartRow, StepFinishData } from "./message"
import { debug } from "../debug"

const dlog = debug("compaction")

// ---------------------------------------------------------------------------
// estimateTokens — chars/4 heuristic on the content that will be sent
// ---------------------------------------------------------------------------
/**
 * Estimate the token count for a system prompt + model messages using the `chars / 4` heuristic.
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
// ---------------------------------------------------------------------------
/**
 * Returns the model's context window from the model limit info.
 * Returns 0 if the model limit is not available.
 */
export function getContextWindow(
  modelLimit: { context: number; input?: number; output: number } | null,
): number {
  if (modelLimit && modelLimit.context > 0) {
    dlog("getContextWindow: %d (from models.dev)", modelLimit.context)
    return modelLimit.context
  }
  dlog("getContextWindow: 0 (model limit unavailable)")
  return 0
}

// ---------------------------------------------------------------------------
// isOverContextThreshold — pure helper for percentage comparison
// ---------------------------------------------------------------------------
/**
 * Check if the given input token count exceeds the threshold fraction of the context window.
 */
export function isOverContextThreshold(
  inputTokens: number,
  contextWindow: number,
  threshold: number,
): boolean {
  return inputTokens >= contextWindow * threshold
}

// ---------------------------------------------------------------------------
// getLastInputTokens — read the last step-finish's input token count
// ---------------------------------------------------------------------------
/**
 * Returns the input token count from the most recent step-finish part.
 * Used to restore the token-% bar when switching/resuming sessions.
 */
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
