// Session title generation — auto-name sessions from first user message
//
// Uses a lightweight LLM call (generateText) to produce a 2-5 word
// noun phrase describing the topic. Inspired by craft-agents-oss.
//
// Called async from prompt.ts — does NOT block the agent loop.

import { generateText, type LanguageModel } from "ai"
import { setSessionTitle } from "./session"

/**
 * Build a prompt for generating a session title from a user message.
 * Takes at most the first 500 chars to keep it cheap.
 */
export function buildTitlePrompt(message: string): string {
  const snippet = message.slice(0, 500)
  return [
    "What topic or area is the user exploring? Reply with ONLY a short topic label (2-5 words).",
    "Use a noun phrase — NOT a verb/action. Use plain text only — no markdown, no quotes.",
    "If the user has a clear specific task, name the area it belongs to, not the action.",
    'Examples: "Auto Title Generation", "Dark Mode Support", "API Authentication", "Database Schema Design", "React Performance"',
    "",
    "User: " + snippet,
    "",
    "Topic:",
  ].join("\n")
}

/**
 * Validate and clean a generated title.
 * Returns null if the title is empty or too long.
 */
export function validateTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim()?.replace(/^["']|["']$/g, "")
  if (trimmed && trimmed.length > 0 && trimmed.length < 80) {
    return trimmed
  }
  return null
}

/**
 * Generate and persist a session title from the first user message.
 * Fires a lightweight LLM call — call this without awaiting so it
 * doesn't block the main agent loop.
 */
export async function generateSessionTitle(input: {
  sessionId: string
  message: string
  model: LanguageModel
}): Promise<void> {
  try {
    const prompt = buildTitlePrompt(input.message)
    const result = await generateText({
      model: input.model,
      messages: [{ role: "user", content: prompt }],
      maxRetries: 1,
    })

    const title = validateTitle(result.text)
    if (title) {
      setSessionTitle(input.sessionId, title)
    }
  } catch {
    // Title generation is best-effort — never fail the session
  }
}
