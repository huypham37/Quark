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
import { createCodexConsumer } from "./codex-consumer"
import {
  CodexTokenStore,
  refreshToken as refreshCodexToken,
  type FetchFn,
} from "./codex-auth"
import { loadToken as loadCopilotToken } from "./copilot-auth"
import { getCustomFetch } from "./custom-fetch"

export interface ResolveModelOptions {
  codexFetch?: FetchFn
  codexTokenStore?: CodexTokenStore
  refreshCodexToken?: typeof refreshCodexToken
}

export async function resolveModel(
  modelSpec?: string,
  kind: "main" | "small" = "main",
  options: ResolveModelOptions = {},
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
      const token = loadCopilotToken()
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

  if (providerId === "codex") {
    const tokenStore = options.codexTokenStore ?? new CodexTokenStore()
    let token = tokenStore.load()
    if (!token) {
      throw new Error(
        "No Codex token found. Run the login flow first (scripts/codex-login.ts).",
      )
    }
    const getToken = async () => {
      if (Date.now() >= token!.expires) {
        try {
          const refresh = options.refreshCodexToken ?? refreshCodexToken
          token = await refresh({ refreshToken: token!.refresh })
          tokenStore.save(token)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Codex login expired. Run scripts/codex-login.ts to sign in again. ${detail}`,
          )
        }
      }
      return token!.access
    }
    return createCodexConsumer({
      modelId,
      getToken,
      getAccountId: async () => token!.accountId,
      fetch: options.codexFetch,
    })
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
