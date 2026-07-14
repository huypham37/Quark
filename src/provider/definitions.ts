import type { CredentialSourceConfig } from "./credentials"

export type ProviderProtocol =
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "codex-consumer"

export type BillingMode = "metered" | "subscription" | "free" | "unknown"

export type AuthDefinition =
  | { type: "api-key"; environmentVariables: readonly string[] }
  | { type: "oauth-device"; implementation: "copilot" | "codex" }
  | { type: "none" }

export interface ProviderDefinition {
  id: string
  name: string
  protocol: ProviderProtocol
  defaultEndpoint?: string
  auth: AuthDefinition
  metadataProviderId: string
  providerOptionsKey: string
  billing: BillingMode
}

export interface ProviderRegistration {
  definition: ProviderDefinition
  credentialSource: CredentialSourceConfig
}

export const BUNDLED_PROVIDER_DEFINITIONS = {
  openai: {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    auth: { type: "api-key", environmentVariables: ["OPENAI_API_KEY"] },
    metadataProviderId: "openai",
    providerOptionsKey: "openai",
    billing: "metered",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    auth: { type: "api-key", environmentVariables: ["ANTHROPIC_API_KEY"] },
    metadataProviderId: "anthropic",
    providerOptionsKey: "anthropic",
    billing: "metered",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    auth: { type: "api-key", environmentVariables: ["OPENROUTER_API_KEY"] },
    metadataProviderId: "openrouter",
    providerOptionsKey: "openrouter",
    billing: "metered",
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    protocol: "openai-compatible",
    defaultEndpoint: "https://api.githubcopilot.com",
    auth: { type: "oauth-device", implementation: "copilot" },
    metadataProviderId: "github-copilot",
    providerOptionsKey: "copilot",
    billing: "subscription",
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    protocol: "codex-consumer",
    auth: { type: "oauth-device", implementation: "codex" },
    metadataProviderId: "openai",
    providerOptionsKey: "codex",
    billing: "subscription",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    protocol: "openai-compatible",
    defaultEndpoint: "http://localhost:11434/v1",
    auth: { type: "none" },
    metadataProviderId: "ollama",
    providerOptionsKey: "ollama",
    billing: "free",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    protocol: "openai-compatible",
    defaultEndpoint: "http://localhost:1234/v1",
    auth: { type: "none" },
    metadataProviderId: "lmstudio",
    providerOptionsKey: "lmstudio",
    billing: "free",
  },
} as const satisfies Record<string, ProviderDefinition>
