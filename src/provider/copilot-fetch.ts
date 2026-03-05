// Copilot fetch wrapper
// Injects Copilot-specific headers on every LLM request:
// - Authorization: Bearer <token>
// - Openai-Intent: conversation-edits
// - x-initiator: user | agent
// - Copilot-Vision-Request: true (when images present)
// Also removes x-api-key (Copilot uses Bearer auth, not API keys).

import type { FetchFn } from "./copilot-auth"

// ---------------------------------------------------------------------------
// inferInitiator — decides "user" vs "agent" from the request body
// Chat API: looks at messages[last].role
// Responses API: looks at input[last].role
// ---------------------------------------------------------------------------
export function inferInitiator(body: unknown): "user" | "agent" {
  if (!body || typeof body !== "object") return "user"

  const b = body as Record<string, unknown>

  // Chat Completions API — body.messages
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    const last = b.messages[b.messages.length - 1]
    if (last && typeof last === "object" && "role" in last) {
      return (last as { role: string }).role === "user" ? "user" : "agent"
    }
  }

  // Responses API — body.input
  if (Array.isArray(b.input) && b.input.length > 0) {
    const last = b.input[b.input.length - 1]
    if (last && typeof last === "object" && "role" in last) {
      return (last as { role: string }).role === "user" ? "user" : "agent"
    }
    // Items without a "role" property (e.g. function_call) are agent-initiated
    return "agent"
  }

  return "user"
}

// ---------------------------------------------------------------------------
// hasVisionContent — detects image content in the request body
// Chat API: looks for type: "image_url" in message content arrays
// Responses API: looks for type: "input_image" in input content arrays
// ---------------------------------------------------------------------------
export function hasVisionContent(body: unknown): boolean {
  if (!body || typeof body !== "object") return false

  const b = body as Record<string, unknown>

  // Chat Completions API — body.messages
  if (Array.isArray(b.messages)) {
    return b.messages.some((msg: unknown) => {
      if (!msg || typeof msg !== "object") return false
      const m = msg as Record<string, unknown>
      if (!Array.isArray(m.content)) return false
      return m.content.some(
        (part: unknown) =>
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "image_url",
      )
    })
  }

  // Responses API — body.input
  if (Array.isArray(b.input)) {
    return b.input.some((item: unknown) => {
      if (!item || typeof item !== "object") return false
      const it = item as Record<string, unknown>
      if (!Array.isArray(it.content)) return false
      return it.content.some(
        (part: unknown) =>
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "input_image",
      )
    })
  }

  return false
}

// ---------------------------------------------------------------------------
// createCopilotFetch — wraps fetch with Copilot headers
// ---------------------------------------------------------------------------
export function createCopilotFetch(options: {
  getToken: () => Promise<string>
  fetch?: FetchFn
}): FetchFn {
  const baseFetch = options.fetch ?? globalThis.fetch

  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = await options.getToken()

    // Parse the body to determine initiator and vision content
    let parsedBody: unknown = undefined
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        // Not JSON — leave parsedBody undefined
      }
    }

    // Build new headers
    const headers = new Headers(init?.headers as Record<string, string>)

    // Remove x-api-key — Copilot uses Bearer auth
    headers.delete("x-api-key")

    // Set Copilot-specific headers
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Openai-Intent", "conversation-edits")
    headers.set("x-initiator", inferInitiator(parsedBody))

    // Vision header — only set when images are present
    if (hasVisionContent(parsedBody)) {
      headers.set("Copilot-Vision-Request", "true")
    }

    return baseFetch(input, {
      ...init,
      headers,
    })
  }
}
