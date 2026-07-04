import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

export interface ProviderConfig {
  baseURL: string
  apiKey: string
}

export interface AppConfig {
  mainModel: string
  providers: Record<string, ProviderConfig>
}

export function parseModelSpec(spec: string): { provider: string; model: string } {
  const slash = spec.indexOf("/")

  if (slash === -1) {
    throw new Error(
      `Model spec "${spec}" must include a provider prefix, for example "openai/gpt-4o".`,
    )
  }

  return {
    provider: spec.slice(0, slash),
    model: spec.slice(slash + 1),
  }
}

export function resolveApiKey(value: string): string {
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)] ?? ""
  }

  return value
}

export async function resolveModel(
  config: AppConfig,
  modelSpec = config.mainModel,
): Promise<LanguageModel> {
  const { provider, model } = parseModelSpec(modelSpec)
  const providerConfig = config.providers[provider]

  if (!providerConfig) {
    throw new Error(`Unknown provider "${provider}". Add it to config.providers.`)
  }

  const apiKey = resolveApiKey(providerConfig.apiKey)

  if (provider === "openai") {
    return createOpenAI({
      apiKey,
      baseURL: providerConfig.baseURL,
    })(model)
  }

  if (provider === "anthropic") {
    return createAnthropic({
      apiKey,
      baseURL: providerConfig.baseURL,
    })(model)
  }

  return createOpenAICompatible({
    name: provider,
    apiKey,
    baseURL: providerConfig.baseURL,
  })(model)
}
