// Copilot fetch wrapper
// Injects Copilot-specific headers on every LLM request:
// - Authorization: Bearer <token>
// - Openai-Intent: conversation-edits
// - x-initiator: user | agent
// - Copilot-Vision-Request: true (when images present)
// Also removes x-api-key (Copilot uses Bearer auth, not API keys).

import type { FetchFn } from "./copilot-auth"

// ---------------------------------------------------------------------------
// CopilotFetchFn — extends FetchFn with a runtime thinking-budget setter
// ---------------------------------------------------------------------------
export interface CopilotFetchFn extends FetchFn {
  /** Update the thinking budget. Pass 0 to disable extended thinking. */
  setThinkingBudget(budget: number): void
  /** Force x-initiator to "agent" for all requests (compaction, sub-agents). */
  setForceAgent(force: boolean): void
}

// ---------------------------------------------------------------------------
// inferInitiator — decides "user" vs "agent" from the request body
// Chat API: looks at messages[last].role
// Responses API: looks at input[last].role
// ---------------------------------------------------------------------------
export function inferInitiator(body: unknown): "user" | "agent" {
  if (!body || typeof body !== "object") return "user"

  const b = body as Record<string, unknown>

  // Chat Completions API / Anthropic Messages API — body.messages
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    const last = b.messages[b.messages.length - 1] as Record<string, unknown>
    if (!last || typeof last !== "object" || !("role" in last)) return "user"

    const role = (last as { role: string }).role
    if (role !== "user") return "agent"

    // Anthropic Messages API: a "user" message carrying only tool_result
    // blocks is a tool-call continuation, not a new user prompt.
    if (Array.isArray(last.content)) {
      const hasNonToolResult = (last.content as Record<string, unknown>[]).some(
        (part) => part?.type !== "tool_result",
      )
      return hasNonToolResult ? "user" : "agent"
    }

    return "user"
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
  /** Initial thinking budget in tokens. 0 = disabled (default). */
  thinkingBudget?: number
}): CopilotFetchFn {
  const baseFetch = options.fetch ?? globalThis.fetch
  let currentBudget = options.thinkingBudget ?? 0
  let forceAgent = false

  const fetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = await options.getToken()

    // Parse the body to determine initiator, vision content, and for thinking injection
    let parsedBody: unknown = undefined
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        // Not JSON — leave parsedBody undefined
      }
    }

    // Inject thinking parameter when budget > 0
    let bodyToSend = init?.body
    if (currentBudget > 0 && parsedBody && typeof parsedBody === "object") {
      ;(parsedBody as Record<string, unknown>).thinking = {
        type: "enabled",
        budget_tokens: currentBudget,
      }
      bodyToSend = JSON.stringify(parsedBody)
    }

    // Build new headers
    const headers = new Headers(init?.headers as Record<string, string>)

    // Remove x-api-key — Copilot uses Bearer auth
    headers.delete("x-api-key")

    // Set Copilot-specific headers
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Openai-Intent", "conversation-edits")
    const initiator = forceAgent ? "agent" : inferInitiator(parsedBody)
    if (process.env.DEBUG_INITIATOR) {
      const b = parsedBody as Record<string, unknown> | undefined
      const msgs = Array.isArray(b?.messages) ? b!.messages : []
      const last = msgs[msgs.length - 1] as Record<string, unknown> | undefined
      console.error(`[x-initiator] ${initiator} | forceAgent=${forceAgent} | lastRole=${last?.role} | contentTypes=${Array.isArray(last?.content) ? (last!.content as any[]).map((p: any) => p?.type).join(",") : typeof last?.content}`)
    }
    headers.set("x-initiator", initiator)

    // Vision header — only set when images are present
    if (hasVisionContent(parsedBody)) {
      headers.set("Copilot-Vision-Request", "true")
    }

    return baseFetch(input, {
      ...init,
      body: bodyToSend,
      headers,
    })
  }

  // Attach runtime setters
  fetchFn.setThinkingBudget = (budget: number) => {
    currentBudget = budget
  }
  fetchFn.setForceAgent = (force: boolean) => {
    forceAgent = force
  }

  return fetchFn as CopilotFetchFn
}
