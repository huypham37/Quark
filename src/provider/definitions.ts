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
  /** Connection identity used for credentials and request routing. */
  id: string
  /** models.dev provider whose canonical model metadata this connection uses. */
  catalogProviderId: string
  name: string
  protocol: ProviderProtocol
  defaultEndpoint?: string
  auth: AuthDefinition
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
    catalogProviderId: "openai",
    name: "OpenAI",
    protocol: "openai",
    auth: { type: "api-key", environmentVariables: ["OPENAI_API_KEY"] },
    providerOptionsKey: "openai",
    billing: "metered",
  },
  anthropic: {
    id: "anthropic",
    catalogProviderId: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    auth: { type: "api-key", environmentVariables: ["ANTHROPIC_API_KEY"] },
    providerOptionsKey: "anthropic",
    billing: "metered",
  },
  openrouter: {
    id: "openrouter",
    catalogProviderId: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    auth: { type: "api-key", environmentVariables: ["OPENROUTER_API_KEY"] },
    providerOptionsKey: "openrouter",
    billing: "metered",
  },
  deepseek: {
    id: "deepseek",
    catalogProviderId: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    defaultEndpoint: "https://api.deepseek.com",
    auth: { type: "api-key", environmentVariables: ["DEEPSEEK_API_KEY"] },
    providerOptionsKey: "deepseek",
    billing: "metered",
  },
  copilot: {
    id: "copilot",
    catalogProviderId: "copilot",
    name: "GitHub Copilot",
    protocol: "openai-compatible",
    defaultEndpoint: "https://api.githubcopilot.com",
    auth: { type: "oauth-device", implementation: "copilot" },
    providerOptionsKey: "copilot",
    billing: "subscription",
  },
  "openai-codex": {
    id: "openai-codex",
    catalogProviderId: "openai",
    name: "OpenAI Codex",
    protocol: "codex-consumer",
    auth: { type: "oauth-device", implementation: "codex" },
    providerOptionsKey: "codex",
    billing: "subscription",
  },
  ollama: {
    id: "ollama",
    catalogProviderId: "ollama",
    name: "Ollama",
    protocol: "openai-compatible",
    defaultEndpoint: "http://localhost:11434/v1",
    auth: { type: "none" },
    providerOptionsKey: "ollama",
    billing: "free",
  },
  lmstudio: {
    id: "lmstudio",
    catalogProviderId: "lmstudio",
    name: "LM Studio",
    protocol: "openai-compatible",
    defaultEndpoint: "http://localhost:1234/v1",
    auth: { type: "none" },
    providerOptionsKey: "lmstudio",
    billing: "free",
  },
} as const satisfies Record<string, ProviderDefinition>
