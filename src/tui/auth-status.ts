import { loadConfig } from "../config/config"
import type { ProviderAuthStatus } from "../provider/credentials"

export function formatAuthStatuses(statuses: ProviderAuthStatus[]): string[] {
  return statuses.map((status) => {
    const source = status.origin ? ` · ${status.origin}` : ""
    const expiry = status.expiresAt ? ` · expires ${new Date(status.expiresAt).toISOString()}` : ""
    return `${status.providerId}: ${status.state}${source}${expiry}`
  })
}

export function firstRunAuthMessage(
  modelSpec: string | undefined,
  statuses: ProviderAuthStatus[],
): string | null {
  if (!modelSpec) return null
  const providerId = modelSpec.includes("/") ? modelSpec.slice(0, modelSpec.indexOf("/")) : ""
  const status = statuses.find((item) => item.providerId === providerId)
  if (!status || status.state === "authenticated" || status.state === "not-required") return null
  const custom = loadConfig().providers[providerId]
  return custom?.api_key_env
    ? `Authentication for ${providerId} is ${status.state}. Set ${custom.api_key_env}.`
    : `Authentication for ${providerId} is ${status.state}. Run: quark auth login ${providerId}`
}
