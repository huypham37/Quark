import { loadToken as loadCopilotToken } from "./copilot-auth"
import { loadToken as loadCodexToken } from "./codex-auth"
import type { Credential } from "./credentials"

/**
 * Reads the OAuth token file copilot-auth/codex-auth write under the config
 * directory. The machine store is preferred; migrating these files into it
 * requires user consent, so they remain a supported source.
 */
export async function loadOAuthTokenFile(providerId: string): Promise<Credential | null> {
  if (providerId === "copilot") {
    const token = loadCopilotToken()
    return token ? { type: "oauth", access: token } : null
  }
  if (providerId === "openai-codex") {
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
