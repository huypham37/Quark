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
}

export function buildConnectProviderRows(
  statuses: ProviderAuthStatus[] = [],
  customProviders: Record<string, CustomProviderConfig> = {},
): ConnectProviderRow[] {
  const statusById = new Map(statuses.map((status) => [status.providerId, status.state]))
  const bundled = Object.values(BUNDLED_PROVIDER_DEFINITIONS).map((provider): ConnectProviderRow => ({
    id: provider.id,
    name: provider.name,
    kind: provider.auth.type === "api-key" ? "api-key" : provider.auth.type === "oauth-device" ? "oauth" : "none",
    detail: provider.auth.type === "api-key"
      ? "API key"
      : provider.auth.type === "oauth-device"
        ? "OAuth"
        : "No authentication required",
    status: statusById.get(provider.id),
  }))
  const custom = Object.entries(customProviders).map(([id, provider]): ConnectProviderRow => ({
    id,
    name: id,
    kind: "custom",
    detail: provider.api_key_env ? `Set ${provider.api_key_env}` : "Configure api_key_env",
    status: statusById.get(id),
    environmentVariable: provider.api_key_env,
  }))
  return [...bundled, ...custom]
}

export function safeConnectError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Authentication cancelled"
  return "Authentication failed. Check your credentials and try again."
}
