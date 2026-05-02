// Copilot fetch wrapper
// Injects Copilot-specific headers on every LLM request:
// - Authorization: Bearer <token>
// - Openai-Intent: conversation-edits
// - x-initiator: user | agent
// - Copilot-Vision-Request: true (when images present)
// Also removes x-api-key (Copilot uses Bearer auth, not API keys).

import type { FetchFn } from "./copilot-auth"

// ---------------------------------------------------------------------------
// CopilotFetchFn — FetchFn with a runtime force-agent setter
// ---------------------------------------------------------------------------
export interface CopilotFetchFn extends FetchFn {
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
// rewriteCopilotResponsesStream — normalize rotated reasoning item IDs.
// Copilot's /responses SSE emits a fresh item.id on every event, which breaks
// @ai-sdk/openai's lookup-by-id in its streaming handler. We rewrite the id
// on reasoning `output_item.done` events to match the first id seen for that
// output_index on `output_item.added`.
// ---------------------------------------------------------------------------
function rewriteCopilotResponsesStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const canonicalIds = new Map<number, string>()
  let buf = ""

  const rewrite = (line: string): string => {
    if (!line.startsWith("data: ")) return line
    const payload = line.slice(6)
    if (payload === "[DONE]") return line
    let obj: any
    try { obj = JSON.parse(payload) } catch { return line }

    const t = obj?.type
    const oi = obj?.output_index

    if (t === "response.output_item.added" &&
        obj.item?.type === "reasoning" &&
        typeof oi === "number" &&
        typeof obj.item?.id === "string") {
      canonicalIds.set(oi, obj.item.id)
      return line
    }
    if (t === "response.output_item.done" &&
        obj.item?.type === "reasoning" &&
        typeof oi === "number") {
      const canonical = canonicalIds.get(oi)
      if (canonical && obj.item?.id !== canonical) {
        obj.item.id = canonical
        return "data: " + JSON.stringify(obj)
      }
      return line
    }
    if (typeof t === "string" &&
        t.startsWith("response.reasoning_summary_") &&
        typeof oi === "number") {
      const canonical = canonicalIds.get(oi)
      if (canonical && obj.item_id !== canonical) {
        obj.item_id = canonical
        return "data: " + JSON.stringify(obj)
      }
    }
    return line
  }

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buf += decoder.decode(chunk, { stream: true })
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        controller.enqueue(encoder.encode(rewrite(line) + "\n"))
      }
    },
    flush(controller) {
      if (buf) controller.enqueue(encoder.encode(rewrite(buf)))
    },
  }))
}

// ---------------------------------------------------------------------------
// createCopilotFetch — wraps fetch with Copilot headers
// ---------------------------------------------------------------------------
export function createCopilotFetch(options: {
  getToken: () => Promise<string>
  fetch?: FetchFn
}): CopilotFetchFn {
  const baseFetch = options.fetch ?? globalThis.fetch
  let forceAgent = false

  const fetchFn = async (
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

    const response = await baseFetch(input, {
      ...init,
      headers,
    })

    const contentType = response.headers.get("content-type") ?? ""
    const url = typeof input === "string"
      ? input
      : input instanceof URL ? input.toString() : input.url

    // Normalize Copilot's rotated reasoning item IDs on /responses SSE streams
    if (contentType.includes("text/event-stream") &&
        url.includes("/responses") &&
        response.body) {
      return new Response(rewriteCopilotResponsesStream(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    // Patch: Copilot API omits choices[].index which @ai-sdk/openai requires.
    // Intercept non-streaming JSON responses and add the missing field.
    if (contentType.includes("application/json")) {
      const text = await response.text()
      let json: any
      try { json = JSON.parse(text) } catch { return new Response(text, response) }
      if (Array.isArray(json.choices)) {
        for (let i = 0; i < json.choices.length; i++) {
          if (json.choices[i].index === undefined) json.choices[i].index = i
        }
      }
      return new Response(JSON.stringify(json), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    return response
  }

  // Attach runtime setter
  fetchFn.setForceAgent = (force: boolean) => {
    forceAgent = force
  }

  return fetchFn as CopilotFetchFn
}
