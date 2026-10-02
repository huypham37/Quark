// Central dispatcher for provider-specific fetch wrappers.
import { createCopilotFetch, type CopilotInitiator } from "./copilot-fetch"
import { createCodexFetch } from "./codex-fetch"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCustomFetch(
  providerId: string,
  options?: { getToken: () => Promise<string>; initiator?: CopilotInitiator },
): any {
  if (providerId === "copilot" && options) return createCopilotFetch(options)
  if (providerId === "openai-codex" && options) return createCodexFetch(options)
  return undefined
}
