import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  getProviderConfig,
  loadConfig,
  parseModelSpec,
  resolveApiKey,
} from "../config/config"
import { fireHook } from "../plugin/registry"
import { loadToken } from "./copilot-auth"
import { getCustomFetch } from "./custom-fetch"

export async function resolveModel(
  modelSpec?: string,
  kind: "main" | "small" = "main",
) {
  const cfg = loadConfig()
  const spec = modelSpec ?? (kind === "main" ? cfg.main_model : cfg.small_model)
  const parsed = parseModelSpec(spec)

  let providerId = parsed.provider
  let modelId = parsed.model

  if (!providerId) {
    throw new Error(
      `Model spec "${spec}" must include a provider prefix (e.g. "copilot/gpt-4o").`,
    )
  }

  const beforeOutput = await fireHook(
    "provider.request.before",
    {
      provider: providerId,
      model: modelId,
      messages: [],
    },
    { provider: providerId, model: modelId },
  )
  providerId = beforeOutput.provider
  modelId = beforeOutput.model

  if (providerId === "copilot") {
    const getToken = async () => {
      const token = loadToken()
      if (!token) {
        throw new Error(
          "No Copilot token found. Run the login flow first (scripts/copilot-login.ts).",
        )
      }
      return token
    }
    const fetch = getCustomFetch("copilot", { getToken })
    return createOpenAICompatible({
      name: "copilot",
      baseURL: "https://api.githubcopilot.com",
      apiKey: "copilot",
      fetch,
    })(modelId)
  }

  const pc = getProviderConfig(providerId)
  if (!pc) {
    throw new Error(
      `Unknown provider "${providerId}". Define it in ~/.config/quark/config.yaml under "providers:".`,
    )
  }

  if (providerId === "openai") {
    return createOpenAI({ apiKey: resolveApiKey(pc.apiKey), baseURL: pc.baseURL })(modelId)
  }
  if (providerId === "anthropic") {
    return createAnthropic({ apiKey: resolveApiKey(pc.apiKey), baseURL: pc.baseURL })(modelId)
  }

  return createOpenAICompatible({
    name: providerId,
    baseURL: pc.baseURL,
    apiKey: resolveApiKey(pc.apiKey),
    fetch: getCustomFetch(providerId),
  })(modelId)
}
