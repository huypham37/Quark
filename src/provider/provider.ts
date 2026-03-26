// Copilot provider — creates an @ai-sdk/openai instance pointed at Copilot's API
// and routes models to the correct API (Chat vs Responses).

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { createCopilotFetch } from "./copilot-fetch"

const COPILOT_BASE_URL = "https://api.githubcopilot.com"

// ---------------------------------------------------------------------------
// shouldUseResponsesApi — GPT-5+ (except gpt-5-mini) uses Responses API
// Logic: match /^gpt-(\d+)/ where the major version number >= 5,
// then exclude models containing "-mini".
// ---------------------------------------------------------------------------
export function shouldUseResponsesApi(modelId: string): boolean {
  const match = modelId.match(/^gpt-(\d+)/)
  if (!match) return false

  const majorVersion = parseInt(match[1]!, 10)
  if (majorVersion < 5) return false

  // gpt-5-mini and variants use Chat API
  if (modelId.includes("-mini")) return false

  return true
}

// ---------------------------------------------------------------------------
// createCopilotProvider — creates an @ai-sdk/openai provider for Copilot
// ---------------------------------------------------------------------------
export function createCopilotProvider(options: {
  getToken: () => Promise<string>
  baseURL?: string
}): OpenAIProvider {
  const copilotFetch = createCopilotFetch({
    getToken: options.getToken,
  })

  return createOpenAI({
    name: "copilot",
    baseURL: options.baseURL ?? COPILOT_BASE_URL,
    apiKey: "copilot", // Placeholder — actual auth is via the fetch wrapper
    fetch: copilotFetch as unknown as FetchFunction,
  })
}

// ---------------------------------------------------------------------------
// getModel — routes to chat or responses based on model ID
// ---------------------------------------------------------------------------
export function getModel(
  provider: OpenAIProvider,
  modelId: string,
) {
  if (shouldUseResponsesApi(modelId)) {
    return provider.responses(modelId)
  }
  return provider.chat(modelId)
}
