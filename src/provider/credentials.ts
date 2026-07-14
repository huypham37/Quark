import type { CredentialStore } from "./credential-store"

export type Credential =
  | { type: "api-key"; value: string }
  | {
      type: "oauth"
      access: string
      refresh?: string
      expiresAt?: number
      metadata?: Record<string, unknown>
    }

export type CredentialOrigin =
  | "session"
  | "environment"
  | "machine-store"
  | "legacy-token-file"

export type CredentialSourceConfig =
  | { source: "auto" }
  | { source: "environment"; variable: string }
  | { source: "prompt" }
  | { source: "store" }
  | { source: "none" }

export interface CredentialProviderDefinition {
  id: string
  auth:
    | { type: "api-key"; environmentVariables: readonly string[] }
    | { type: "oauth-device"; implementation: "copilot" | "codex" }
    | { type: "none" }
}

export interface ResolvedCredential {
  credential: Credential
  origin: CredentialOrigin
}

export interface ProviderAuthStatus {
  providerId: string
  state: "authenticated" | "missing" | "expired" | "not-required" | "unavailable"
  origin?: CredentialOrigin
  expiresAt?: number
  message?: string
}

export type CredentialPrompt = (providerId: string) => Promise<Credential | null>
export type LegacyCredentialLoader = (providerId: string) => Promise<Credential | null>

const REDACTED = "[REDACTED]"
const processSessionCredentials = new Map<string, Credential>()

export function setProcessSessionCredential(providerId: string, credential: Credential): void {
  processSessionCredentials.set(providerId, credential)
}

export function deleteProcessSessionCredential(providerId: string): void {
  processSessionCredentials.delete(providerId)
}

export function clearProcessSessionCredentials(): void {
  processSessionCredentials.clear()
}

function validateEnvironmentVariable(variable: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variable)) {
    throw new Error(`Invalid environment variable name "${variable}".`)
  }
}

/** A resolved credential whose inspection and JSON representations are redacted. */
export class RedactedResolvedCredential implements ResolvedCredential {
  constructor(
    public readonly credential: Credential,
    public readonly origin: CredentialOrigin,
  ) {}

  toString(): string {
    return `[ResolvedCredential origin=${this.origin} credential=${REDACTED}]`
  }

  toJSON(): { origin: CredentialOrigin; credential: string } {
    return { origin: this.origin, credential: REDACTED }
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString()
  }
}

export class DefaultCredentialResolver {
  private readonly sessionCredentials = new Map<string, Credential>()

  constructor(
    private readonly store: CredentialStore,
    private readonly prompt?: CredentialPrompt,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly loadLegacy?: LegacyCredentialLoader,
  ) {}

  setSessionCredential(providerId: string, credential: Credential): void {
    this.sessionCredentials.set(providerId, credential)
  }

  deleteSessionCredential(providerId: string): void {
    this.sessionCredentials.delete(providerId)
  }

  clearSessionCredentials(): void {
    this.sessionCredentials.clear()
  }

  async resolve(input: {
    provider: CredentialProviderDefinition
    source: CredentialSourceConfig
    interactive: boolean
  }): Promise<ResolvedCredential | null> {
    const session = this.sessionCredentials.get(input.provider.id)
      ?? processSessionCredentials.get(input.provider.id)
    if (session) return new RedactedResolvedCredential(session, "session")

    switch (input.source.source) {
      case "none":
        return null
      case "environment":
        return this.resolveEnvironment(input.source.variable)
      case "store":
        return this.resolveStore(input.provider.id)
      case "prompt": {
        if (!input.interactive) {
          throw new Error(
            `Credential source "prompt" for "${input.provider.id}" requires an interactive session. Use an environment variable or machine store.`,
          )
        }
        if (!this.prompt) throw new Error(`No credential prompt is available for "${input.provider.id}".`)
        const credential = await this.prompt(input.provider.id)
        if (!credential) return null
        this.sessionCredentials.set(input.provider.id, credential)
        return new RedactedResolvedCredential(credential, "session")
      }
      case "auto": {
        if (input.provider.auth.type === "none") return null
        if (input.provider.auth.type === "api-key") {
          for (const variable of input.provider.auth.environmentVariables) {
            const credential = this.resolveEnvironment(variable)
            if (credential) return credential
          }
        }
        const stored = await this.resolveStore(input.provider.id)
        if (stored) return stored
        if (input.provider.auth.type === "oauth-device" && this.loadLegacy) {
          const legacy = await this.loadLegacy(input.provider.id)
          if (legacy) return new RedactedResolvedCredential(legacy, "legacy-token-file")
        }
        return null
      }
    }
  }

  async status(input: {
    provider: CredentialProviderDefinition
    source: CredentialSourceConfig
  }): Promise<ProviderAuthStatus> {
    if (input.provider.auth.type === "none" || input.source.source === "none") {
      return { providerId: input.provider.id, state: "not-required" }
    }
    try {
      const resolved = await this.resolve({ ...input, interactive: false })
      if (!resolved) return { providerId: input.provider.id, state: "missing" }
      const expiresAt = resolved.credential.type === "oauth" ? resolved.credential.expiresAt : undefined
      return {
        providerId: input.provider.id,
        state: expiresAt !== undefined && expiresAt <= Date.now() ? "expired" : "authenticated",
        origin: resolved.origin,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      }
    } catch (error) {
      return {
        providerId: input.provider.id,
        state: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private resolveEnvironment(variable: string): ResolvedCredential | null {
    validateEnvironmentVariable(variable)
    const value = this.environment[variable]
    if (!value) return null
    return new RedactedResolvedCredential({ type: "api-key", value }, "environment")
  }

  private async resolveStore(providerId: string): Promise<ResolvedCredential | null> {
    const credential = await this.store.get(providerId)
    return credential
      ? new RedactedResolvedCredential(credential, "machine-store")
      : null
  }
}
