import type { CredentialStore } from "../provider/credential-store"
import { createDefaultCredentialStore } from "../provider/credential-store"
import {
  DefaultCredentialResolver,
  clearProcessSessionCredentials,
  deleteProcessSessionCredential,
  setProcessSessionCredential,
  type ProviderAuthStatus,
} from "../provider/credentials"
import { BUNDLED_PROVIDER_DEFINITIONS, type ProviderDefinition } from "../provider/definitions"
import { loadLegacyProviderCredential } from "../provider/legacy-credentials"
import { normalizeDomain, pollForToken, requestDeviceCode } from "../provider/copilot-auth"
import { loginWithBrowser, loginWithDeviceCode, type CodexToken } from "../provider/codex-auth"
import type { Credential } from "../provider/credentials"
import { loadConfig } from "../config/config"

export interface OAuthDeviceCode {
  userCode: string
  verificationUri: string
  intervalSeconds: number
}

export interface OAuthLoginImplementations {
  requestCopilotDeviceCode?: typeof requestDeviceCode
  pollCopilotToken?: typeof pollForToken
  loginCodexWithBrowser?: typeof loginWithBrowser
  loginCodexWithDeviceCode?: typeof loginWithDeviceCode
}

export type AuthPersistence = "session" | "store"

export interface AuthServices {
  store?: CredentialStore
  environment?: NodeJS.ProcessEnv
}

function definition(providerId: string): ProviderDefinition {
  const normalized = providerId.toLowerCase()
  const bundled = BUNDLED_PROVIDER_DEFINITIONS[normalized as keyof typeof BUNDLED_PROVIDER_DEFINITIONS]
  if (bundled) return bundled
  const custom = loadConfig().providers[normalized]
  if (!custom) throw new Error(`Unknown provider "${providerId}".`)
  return {
    id: normalized,
    name: normalized,
    protocol: "openai-compatible",
    defaultEndpoint: custom.base_url,
    auth: { type: "api-key", environmentVariables: custom.api_key_env ? [custom.api_key_env] : [] },
    metadataProviderId: normalized,
    providerOptionsKey: normalized,
    billing: custom.billing,
  }
}

async function resolver(services: AuthServices): Promise<DefaultCredentialResolver> {
  const result = new DefaultCredentialResolver(
    services.store ?? await createDefaultCredentialStore(),
    undefined,
    services.environment ?? process.env,
    loadLegacyProviderCredential,
  )
  return result
}

export async function loginApiKey(input: {
  providerId: string
  apiKey: string
  persistence: AuthPersistence
  services?: AuthServices
}): Promise<ProviderAuthStatus> {
  const provider = definition(input.providerId)
  if (provider.auth.type !== "api-key") throw new Error(`Provider "${provider.id}" does not use API-key authentication.`)
  const value = input.apiKey.trim()
  if (!value) throw new Error("API key must not be empty.")
  const credential = { type: "api-key" as const, value }
  if (input.persistence === "session") setProcessSessionCredential(provider.id, credential)
  else await (input.services?.store ?? await createDefaultCredentialStore()).set(provider.id, credential)
  return { providerId: provider.id, state: "authenticated", origin: input.persistence === "session" ? "session" : "machine-store" }
}

export async function loginOAuth(input: {
  providerId: string
  persistence: AuthPersistence
  method?: "browser" | "device"
  enterpriseDomain?: string
  onDeviceCode: (info: OAuthDeviceCode) => void
  onBrowserUrl?: (url: string) => void
  onBrowserPrompt?: () => Promise<string>
  signal?: AbortSignal
  services?: AuthServices
  implementations?: OAuthLoginImplementations
}): Promise<ProviderAuthStatus> {
  const provider = definition(input.providerId)
  if (provider.auth.type !== "oauth-device") {
    throw new Error(`Provider "${provider.id}" does not use OAuth authentication.`)
  }

  const implementations = input.implementations ?? {}
  let credential: Credential
  if (provider.auth.implementation === "copilot") {
    const domain = input.enterpriseDomain === undefined
      ? "github.com"
      : normalizeDomain(input.enterpriseDomain)
    if (!domain) throw new Error(`Invalid Copilot enterprise domain "${input.enterpriseDomain}".`)

    const device = await (implementations.requestCopilotDeviceCode ?? requestDeviceCode)({ domain })
    input.onDeviceCode({
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      intervalSeconds: device.interval,
    })
    const access = await (implementations.pollCopilotToken ?? pollForToken)({
      domain,
      deviceCode: device.device_code,
      interval: device.interval,
      signal: input.signal,
    })
    credential = {
      type: "oauth",
      access,
      ...(domain === "github.com" ? {} : { metadata: { domain } }),
    }
  } else {
    const token = input.method === "device"
      ? await (implementations.loginCodexWithDeviceCode ?? loginWithDeviceCode)({
          onDeviceCode: input.onDeviceCode,
          signal: input.signal,
        })
      : await (implementations.loginCodexWithBrowser ?? loginWithBrowser)({
          onUrl: input.onBrowserUrl ?? (() => {}),
          onPrompt: input.onBrowserPrompt ?? (async () => ""),
          signal: input.signal,
        })
    credential = codexCredential(token)
  }

  if (input.persistence === "session") setProcessSessionCredential(provider.id, credential)
  else await (input.services?.store ?? await createDefaultCredentialStore()).set(provider.id, credential)
  return { providerId: provider.id, state: "authenticated", origin: input.persistence === "session" ? "session" : "machine-store" }
}

function codexCredential(token: CodexToken): Credential {
  return {
    type: "oauth",
    access: token.access,
    refresh: token.refresh,
    expiresAt: token.expires,
    metadata: { accountId: token.accountId },
  }
}

export async function authStatus(services: AuthServices = {}): Promise<ProviderAuthStatus[]> {
  const resolve = await resolver(services)
  const configured = Object.keys(loadConfig().providers)
  const providerIds = [...new Set([...Object.keys(BUNDLED_PROVIDER_DEFINITIONS), ...configured]
    .map((providerId) => providerId.toLowerCase()))]
  return Promise.all(providerIds.map((providerId) => {
    const provider = definition(providerId)
    const custom = loadConfig().providers[providerId]
    const bundled = providerId in BUNDLED_PROVIDER_DEFINITIONS
    return resolve.status({
      provider,
      source: bundled
        ? { source: "auto" }
        : custom?.api_key_env
        ? { source: "environment", variable: custom.api_key_env }
        : custom?.legacyCredentialSource ?? { source: "auto" },
    })
  }))
}

export async function logoutProvider(providerId: string, services: AuthServices = {}): Promise<void> {
  const provider = definition(providerId)
  deleteProcessSessionCredential(provider.id)
  await (services.store ?? await createDefaultCredentialStore()).delete(provider.id)
  // Legacy token files are intentionally never deleted automatically.
}

export function clearSessionCredentials(): void {
  clearProcessSessionCredentials()
}
