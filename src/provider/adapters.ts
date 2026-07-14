import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { createCodexConsumer } from "./codex-consumer"
import { refreshToken as refreshCodexToken, type FetchFn } from "./codex-auth"
import type { CredentialStore } from "./credential-store"
import type { ResolvedCredential } from "./credentials"
import type { ProviderDefinition } from "./definitions"
import { getCustomFetch } from "./custom-fetch"
import type { ProviderAdapter } from "./registry"

export interface ProviderAdapterOptions {
  codexFetch?: FetchFn
  refreshCodexToken?: typeof refreshCodexToken
  credentialStore?: CredentialStore
  onCodexRefresh?: (token: {
    access: string
    refresh: string
    expires: number
    accountId: string
  }) => Promise<void> | void
}

function requireApiKey(
  definition: ProviderDefinition,
  credential: ResolvedCredential | null,
): string {
  if (definition.auth.type === "none") return "none"
  if (credential?.credential.type !== "api-key") {
    const environment = definition.auth.type === "api-key"
      ? definition.auth.environmentVariables.join(" or ")
      : "provider login"
    throw new Error(`No credential found for "${definition.id}". Configure ${environment}.`)
  }
  return credential.credential.value
}

function requireOAuth(
  definition: ProviderDefinition,
  credential: ResolvedCredential | null,
) {
  if (credential?.credential.type !== "oauth") {
    const remediation = definition.id === "codex" || definition.id === "copilot"
      ? `Run quark auth login ${definition.id} to sign in first.`
      : "Run the login flow first."
    throw new Error(`No ${definition.id === "codex" ? "Codex" : definition.name} token found. ${remediation}`)
  }
  return credential.credential
}

export function createProviderAdapter(
  definition: ProviderDefinition,
  options: ProviderAdapterOptions = {},
): ProviderAdapter {
  return {
    definition,
    async createLanguageModel({ modelId, credential }): Promise<LanguageModel> {
      if (definition.protocol === "openai") {
        return createOpenAI({
          apiKey: requireApiKey(definition, credential),
          ...(definition.defaultEndpoint ? { baseURL: definition.defaultEndpoint } : {}),
        })(modelId)
      }

      if (definition.protocol === "anthropic") {
        return createAnthropic({
          apiKey: requireApiKey(definition, credential),
          ...(definition.defaultEndpoint ? { baseURL: definition.defaultEndpoint } : {}),
        })(modelId)
      }

      if (definition.protocol === "codex-consumer") {
        let oauth = requireOAuth(definition, credential)
        const getToken = async () => {
          if (oauth.expiresAt !== undefined && Date.now() >= oauth.expiresAt) {
            if (!oauth.refresh) throw new Error(`${definition.name} login expired. Sign in again.`)
            try {
              const refresh = options.refreshCodexToken ?? refreshCodexToken
              const refreshed = await refresh({ refreshToken: oauth.refresh })
              oauth = {
                type: "oauth",
                access: refreshed.access,
                refresh: refreshed.refresh,
                expiresAt: refreshed.expires,
                metadata: { accountId: refreshed.accountId },
              }
              if (options.onCodexRefresh) {
                await options.onCodexRefresh(refreshed)
              } else if (credential?.origin === "machine-store" && options.credentialStore) {
                await options.credentialStore.set(definition.id, oauth)
              }
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              const remediation = definition.id === "codex"
                ? "Run quark auth login codex to sign in again."
                : "Sign in again."
              const name = definition.id === "codex" ? "Codex" : definition.name
              throw new Error(`${name} login expired. ${remediation} ${detail}`)
            }
          }
          return oauth.access
        }
        return createCodexConsumer({
          modelId,
          getToken,
          getAccountId: async () => typeof oauth.metadata?.accountId === "string"
            ? oauth.metadata.accountId
            : "unknown",
          fetch: options.codexFetch,
        })
      }

      if (!definition.defaultEndpoint) {
        throw new Error(`Provider "${definition.id}" has no endpoint.`)
      }

      if (definition.auth.type === "oauth-device") {
        const oauth = requireOAuth(definition, credential)
        const fetch = getCustomFetch(definition.id, { getToken: async () => oauth.access })
        const enterpriseDomain = definition.id === "copilot" && typeof oauth.metadata?.domain === "string"
          ? oauth.metadata.domain
          : undefined
        return createOpenAICompatible({
          name: definition.id,
          baseURL: enterpriseDomain ? `https://copilot-api.${enterpriseDomain}` : definition.defaultEndpoint,
          apiKey: definition.id,
          fetch,
        })(modelId)
      }

      return createOpenAICompatible({
        name: definition.id,
        baseURL: definition.defaultEndpoint,
        apiKey: requireApiKey(definition, credential),
        fetch: getCustomFetch(definition.id),
      })(modelId)
    },
  }
}
