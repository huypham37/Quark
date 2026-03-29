// Copilot provider — creates an @ai-sdk/openai instance pointed at Copilot's API
// and routes models to the correct API (Chat vs Responses).
// For Claude models with thinking enabled, uses @ai-sdk/anthropic pointed at
// https://api.githubcopilot.com/v1 (the native Anthropic Messages API endpoint).

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai"
import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { createCopilotFetch, type CopilotFetchFn } from "./copilot-fetch"

const COPILOT_BASE_URL = "https://api.githubcopilot.com"
// Anthropic Messages API endpoint exposed by GitHub Copilot
const COPILOT_ANTHROPIC_BASE_URL = "https://api.githubcopilot.com/v1"

// ---------------------------------------------------------------------------
// Module-level reference to the active CopilotFetchFn so the TUI can toggle
// extended thinking without rebuilding the entire provider.
// Cached provider so the same fetch instance (and its budget) is reused
// across calls to createCopilotProvider with the same baseURL.
// ---------------------------------------------------------------------------
let _copilotFetch: CopilotFetchFn | undefined
let _copilotProvider: OpenAIProvider | undefined
let _copilotAnthropicProvider: AnthropicProvider | undefined
let _copilotBaseURL: string | undefined
/** Desired thinking budget — persisted so new providers pick it up correctly */
let _thinkingBudget = 0

/**
 * Set the thinking budget on the active Copilot fetch wrapper.
 * Pass a positive number (e.g. 10000) to enable, 0 to disable.
 * Also persists the desired budget so it is applied if the provider
 * is created after this call (e.g. on first message).
 */
export function setCopilotThinking(budget: number): void {
  _thinkingBudget = budget
  if (_copilotFetch) {
    // Provider already created — clear fetch-layer injection (Anthropic path
    // passes thinking via providerOptions instead of injecting into body)
    _copilotFetch.setThinkingBudget(0)
  }
  // Reset cached Anthropic provider so it gets a fresh fetch instance next call
  _copilotAnthropicProvider = undefined
}

/** Returns the current thinking budget (0 = disabled). */
export function getCopilotThinkingBudget(): number {
  return _thinkingBudget
}

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
// isClaude — returns true for claude-* model IDs
// ---------------------------------------------------------------------------
export function isClaude(modelId: string): boolean {
  return modelId.startsWith("claude-")
}

// ---------------------------------------------------------------------------
// createCopilotProvider — creates an @ai-sdk/openai provider for Copilot.
// Cached: the same provider + fetch instance is returned for the same baseURL
// so that setCopilotThinking() budget changes persist across messages.
// ---------------------------------------------------------------------------
export function createCopilotProvider(options: {
  getToken: () => Promise<string>
  baseURL?: string
}): OpenAIProvider {
  const baseURL = options.baseURL ?? COPILOT_BASE_URL
  // Reuse cached provider when baseURL hasn't changed
  if (_copilotProvider && _copilotBaseURL === baseURL) {
    return _copilotProvider
  }

  const copilotFetch = createCopilotFetch({
    getToken: options.getToken,
    thinkingBudget: _thinkingBudget,
  })
  _copilotFetch = copilotFetch
  _copilotBaseURL = baseURL

  _copilotProvider = createOpenAI({
    name: "copilot",
    baseURL,
    apiKey: "copilot", // Placeholder — actual auth is via the fetch wrapper
    fetch: copilotFetch as unknown as FetchFunction,
  })
  return _copilotProvider
}

export function createOpenAICompatibleProvider(options: {
  name: string
  baseURL: string
  apiKey: string
}): OpenAIProvider {
  return createOpenAI({
    name: options.name,
    baseURL: options.baseURL,
    apiKey: options.apiKey,
  })
}

// ---------------------------------------------------------------------------
// createCopilotAnthropicProvider — creates an @ai-sdk/anthropic provider
// pointing at GitHub Copilot's native Anthropic Messages API endpoint.
// Used when thinking is enabled so that thinking events (reasoning-start/delta/end)
// are properly streamed.
// ---------------------------------------------------------------------------
export function createCopilotAnthropicProvider(options: {
  getToken: () => Promise<string>
}): AnthropicProvider {
  if (_copilotAnthropicProvider) {
    return _copilotAnthropicProvider
  }

  // Create a plain fetch wrapper that adds Copilot auth headers.
  // We do NOT inject thinking here — it comes from providerOptions in streamText.
  const copilotFetch = createCopilotFetch({
    getToken: options.getToken,
    thinkingBudget: 0, // thinking via providerOptions, not body injection
  })

  _copilotAnthropicProvider = createAnthropic({
    // @ai-sdk/anthropic appends /messages to the base URL → /v1/messages
    baseURL: COPILOT_ANTHROPIC_BASE_URL,
    apiKey: "copilot", // Placeholder — actual auth is via the fetch wrapper
    fetch: copilotFetch as unknown as FetchFunction,
  })
  return _copilotAnthropicProvider
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
