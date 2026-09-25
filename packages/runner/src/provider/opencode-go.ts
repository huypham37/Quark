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

/**
 * Adds the client identity and stable conversation ID required by OpenCode Go.
 *
 * `sessionId` is the run's ID, threaded from `ResolveModelOptions` so two
 * concurrent instance runners never share a conversation. When it is absent
 * (legacy CLI/TUI path) the process-global `QUARK_SESSION_ID` is read per
 * request, and a fetch-local id is used only if neither exists. The fallback is
 * per-fetch, not process-global, so it cannot leak between runners.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOpenCodeGoFetch(
  baseFetch: typeof fetch = globalThis.fetch,
  sessionId?: string,
): any {
  const explicit = sessionId?.trim()
  let fallback: string | undefined
  const currentSessionId = () =>
    explicit || process.env.QUARK_SESSION_ID?.trim() || (fallback ??= crypto.randomUUID())
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    headers.set("user-agent", "quark/0.1.0")
    headers.set("x-opencode-session", currentSessionId())
    return baseFetch(input, { ...init, headers })
  }
}
