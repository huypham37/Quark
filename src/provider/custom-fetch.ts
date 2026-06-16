// Central dispatcher for all custom fetch wrappers.
// Extensible: new providers that need custom headers, stream normalization, etc.
// just add a function here.

import { createCopilotFetch, type CopilotFetchFn } from "./copilot-fetch"
import { createCodexFetch } from "./codex-fetch"

const copilotInstances = new Map<string, CopilotFetchFn>()

/**
 * Force x-initiator to "agent" for all Copilot requests.
 * Use around compaction runs and for sub-agent sessions.
 */
export function setForceAgent(force: boolean): void {
  for (const fetch of copilotInstances.values()) {
    fetch.setForceAgent(force)
  }
}

/**
 * Returns a custom fetch wrapper for the given provider, or undefined
 * if the standard fetch works fine.
 * Extend this with new functions when adding providers that need
 * custom headers, stream normalization, etc.
 *
 * NOTE: Returns `any` to avoid Bun's typeof-fetch-includes-preconnect type
 * mismatch. The caller (prompt.ts) passes this directly to createOpenAICompatible's
 * fetch parameter which accepts `typeof fetch`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCustomFetch(
  providerId: string,
  options?: { getToken: () => Promise<string> },
): any {
  if (providerId === "copilot" && options) {
    const fetch = createCopilotFetch(options)
    copilotInstances.set("copilot", fetch)
    return fetch
  }
  if (providerId === "codex" && options) {
    return createCodexFetch(options)
  }
  return undefined
}
