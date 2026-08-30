import type { CustomProviderConfig } from "../config/config"
import type { ProviderAuthStatus } from "../provider/credentials"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../provider/definitions"

export type ConnectProviderKind = "api-key" | "oauth" | "none" | "custom"

export interface ConnectProviderRow {
  id: string
  name: string
  kind: ConnectProviderKind
  detail: string
  status?: "authenticated" | "missing" | "expired" | "not-required" | "unavailable"
  environmentVariable?: string
  credentialOrigin?: ProviderAuthStatus["origin"]
}

export function buildConnectProviderRows(
  statuses: ProviderAuthStatus[] = [],
  customProviders: Record<string, CustomProviderConfig> = {},
): ConnectProviderRow[] {
  const statusById = new Map(statuses.map((status) => [status.providerId.toLowerCase(), status]))
  const bundled = Object.values(BUNDLED_PROVIDER_DEFINITIONS).map((provider): ConnectProviderRow => ({
    id: provider.id,
    name: provider.name,
    kind: provider.auth.type === "api-key" ? "api-key" : provider.auth.type === "oauth-device" ? "oauth" : "none",
    detail: provider.auth.type === "api-key"
      ? "API key"
      : provider.auth.type === "oauth-device"
        ? "OAuth"
        : "No authentication required",
    status: statusById.get(provider.id)?.state,
    credentialOrigin: statusById.get(provider.id)?.origin,
  }))
  const bundledIds = new Set(bundled.map((provider) => provider.id.toLowerCase()))
  const custom = Object.entries(customProviders)
    .filter(([id]) => !bundledIds.has(id.toLowerCase()))
    .map(([id, provider]): ConnectProviderRow => ({
      id,
      name: id,
      kind: "custom",
      detail: provider.api_key_env ? `Set ${provider.api_key_env}` : "Configure api_key_env",
      status: statusById.get(id.toLowerCase())?.state,
      environmentVariable: provider.api_key_env,
      credentialOrigin: statusById.get(id.toLowerCase())?.origin,
    }))
  return [...bundled, ...custom]
}

export function searchConnectProviderRows(providers: ConnectProviderRow[], query: string): ConnectProviderRow[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return providers
  return providers.filter((provider) => `${provider.name} ${provider.id} ${provider.detail}`.toLowerCase().includes(normalizedQuery))
}

export function safeConnectError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Authentication cancelled"
  return "Authentication failed. Check your credentials and try again."
}
