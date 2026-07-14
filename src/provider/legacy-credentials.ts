import { loadToken as loadCopilotToken } from "./copilot-auth"
import { loadToken as loadCodexToken } from "./codex-auth"
import type { Credential } from "./credentials"

/** Compatibility reader only; migration into the machine store requires user consent. */
export async function loadLegacyProviderCredential(providerId: string): Promise<Credential | null> {
  if (providerId === "copilot") {
    const token = loadCopilotToken()
    return token ? { type: "oauth", access: token } : null
  }
  if (providerId === "codex") {
    const token = loadCodexToken()
    return token
      ? {
          type: "oauth",
          access: token.access,
          refresh: token.refresh,
          expiresAt: token.expires,
          metadata: { accountId: token.accountId },
        }
      : null
  }
  return null
}
