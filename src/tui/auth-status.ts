import type { ProviderAuthStatus } from "../provider/credentials"

export function formatAuthStatuses(statuses: ProviderAuthStatus[]): string[] {
  return statuses.map((status) => {
    const source = status.origin ? ` · ${status.origin}` : ""
    const expiry = status.expiresAt ? ` · expires ${new Date(status.expiresAt).toISOString()}` : ""
    return `${status.providerId}: ${status.state}${source}${expiry}`
  })
}

export function firstRunAuthMessage(
  modelSpec: string,
  statuses: ProviderAuthStatus[],
): string | null {
  const providerId = modelSpec.includes("/") ? modelSpec.slice(0, modelSpec.indexOf("/")) : ""
  const status = statuses.find((item) => item.providerId === providerId)
  if (!status || status.state === "authenticated" || status.state === "not-required") return null
  return `Authentication for ${providerId} is ${status.state}. Run: quark auth login ${providerId}`
}
