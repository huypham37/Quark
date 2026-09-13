export type OpenCodeGoApi = "chat" | "responses" | "messages"

const RESPONSES_MODELS = new Set([
  "grok-4.6",
  "gpt-5.6-luna",
  "muse-spark-1.2-contributor",
  "muse-spark-1.3-contributor",
])

const MESSAGES_MODELS = new Set([
  "minimax-m2.5",
  "minimax-m2.7",
  "minimax-m3",
  "qwen3.6-plus",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.8-flash",
  "qwen3.8-max",
])

/** Select the endpoint documented for an OpenCode Go model. */
export function openCodeGoApi(modelId: string): OpenCodeGoApi {
  if (RESPONSES_MODELS.has(modelId)) return "responses"
  if (MESSAGES_MODELS.has(modelId)) return "messages"
  return "chat"
}

let fallbackSessionId: string | undefined

function sessionId(): string {
  const current = process.env.QUARK_SESSION_ID?.trim()
  if (current) return current
  return fallbackSessionId ??= crypto.randomUUID()
}

/** Adds the client identity and stable conversation ID required by OpenCode Go. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOpenCodeGoFetch(baseFetch: typeof fetch = globalThis.fetch): any {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    headers.set("user-agent", "quark/0.1.0")
    headers.set("x-opencode-session", sessionId())
    return baseFetch(input, { ...init, headers })
  }
}
