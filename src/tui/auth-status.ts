import { loadConfig } from "../config/config"
import type { ProviderAuthStatus } from "../provider/credentials"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../provider/definitions"

function hasAuthenticatedConnection(providerId: string, statuses: ProviderAuthStatus[]): boolean {
  const selected = BUNDLED_PROVIDER_DEFINITIONS[
    providerId as keyof typeof BUNDLED_PROVIDER_DEFINITIONS
  ]
  if (!selected) return false

  return statuses.some((status) => {
    if (status.state !== "authenticated") return false
    const connection = BUNDLED_PROVIDER_DEFINITIONS[
      status.providerId as keyof typeof BUNDLED_PROVIDER_DEFINITIONS
    ]
    return connection?.catalogProviderId === selected.catalogProviderId
  })
}

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
  if (
    !status
    || status.state === "authenticated"
    || status.state === "not-required"
    || hasAuthenticatedConnection(providerId, statuses)
  ) return null
  const custom = loadConfig().providers[providerId]
  if (!custom) {
    return `Authentication for ${providerId} is ${status.state}. Run: quark auth login ${providerId}`
  }
  return custom.api_key?.startsWith("env:")
    ? `Authentication for ${providerId} is ${status.state}. Set ${custom.api_key.slice(4)}.`
    : `Authentication for ${providerId} is ${status.state}. Set providers.${providerId}.api_key in config.yaml.`
}
