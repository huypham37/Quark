// ThinkingNormalizer — converts a unified thinking config into
// provider-specific providerOptions for the AI SDK streamText() call.
//
// Model capability dictionary maps each model to its thinking mode:
//   adaptive  → { type: "adaptive", effort: "low" }   (Claude Opus 4.7+, Opus 4.6, Sonnet 4.6)
//   budget    → { type: "enabled", budgetTokens: N }  (Claude Sonnet 3.7, 4.0, Haiku 4.5)
//   effort    → { reasoning: { effort: "low" } }      (OpenAI GPT-5, o-series)
//   native    → { enable_thinking: true }             (Qwen via OpenAI-compatible endpoint)

import type { JSONObject } from "@ai-sdk/provider"

export type ThinkingEffort = "none" | "low" | "medium" | "high" | "xhigh"

// Model thinking capability types
export type ThinkingCapability =
  | { mode: "adaptive"; efforts: ThinkingEffort[]; requiresReasoningReplay?: boolean }
  | { mode: "budget"; minBudget: number; maxBudget: number; requiresReasoningReplay?: boolean }
  | { mode: "effort"; efforts: ThinkingEffort[]; requiresReasoningReplay?: boolean }
  | { mode: "native"; requiresReasoningReplay?: boolean }
  | null

// ---------------------------------------------------------------------------
// Model capability dictionary
// Keys are model IDs (supports prefix matching for copilot-prefixed IDs)
// ---------------------------------------------------------------------------
const MODEL_CAPABILITIES: Record<string, ThinkingCapability> = {
  // Claude — adaptive thinking (recommended, Opus 4.7+ requires it)
  "claude-opus-4-7": { mode: "adaptive", efforts: ["low", "medium", "high", "xhigh"] },
  "claude-opus-4-6": { mode: "adaptive", efforts: ["low", "medium", "high", "xhigh"] },
  "claude-sonnet-4-6": { mode: "adaptive", efforts: ["low", "medium", "high", "xhigh"] },

  // Claude — manual extended thinking (deprecated but still functional)
  "claude-sonnet-4-20250514": { mode: "budget", minBudget: 1024, maxBudget: 32000 },
  "claude-sonnet-4-0-20250514": { mode: "budget", minBudget: 1024, maxBudget: 32000 },
  "claude-3-7-sonnet-20250219": { mode: "budget", minBudget: 1024, maxBudget: 64000 },
  "claude-3-5-sonnet-20241022": { mode: "budget", minBudget: 1024, maxBudget: 64000 },
  "claude-3-5-haiku-20241022": { mode: "budget", minBudget: 1024, maxBudget: 64000 },
  "claude-haiku-4-5-20251001": { mode: "budget", minBudget: 1024, maxBudget: 32000 },

  // OpenAI — reasoning effort (only reasoning models)
  "gpt-5": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "gpt-5.4": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "gpt-5.4-pro": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "gpt-5.2": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "gpt-5-mini": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "gpt-5-nano": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "o4-mini": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "o3": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },
  "o1": { mode: "effort", efforts: ["none", "low", "medium", "high", "xhigh"] },

  // Qwen — native reasoning (Alibaba SDK maps delta.reasoning_content → events)
  "qwen-max": { mode: "native" },
  "qwen-plus": { mode: "native" },
  "qwen-turbo": { mode: "native" },
  "qwen3-max": { mode: "native" },
  "qwen3-plus": { mode: "native" },
  "qwen3.6-plus": { mode: "native" },
  "qwen3.6": { mode: "native" },

  // MiniMax / GLM — native reasoning via OpenAI-compatible endpoint
  "minimax-m2.7": { mode: "native" },
  "glm-5.1": { mode: "native" },

  // Kimi — always emits reasoning and requires reasoning_content on replay.
  // @ai-sdk/openai drops reasoning parts, so a fetch wrapper must inject the field.
  "kimi-": { mode: "native", requiresReasoningReplay: true },

  // DeepSeek — emits reasoning tokens and requires reasoning_content on replay
  // when thinking mode is enabled. @ai-sdk/openai drops reasoning parts, so a
  // fetch wrapper must inject the field.
  "deepseek-": { mode: "native", requiresReasoningReplay: true },
}

// Effort → budget mapping for models that use budget mode
export const EFFORT_TO_BUDGET: Record<ThinkingEffort, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
}

// Budget → effort mapping for models that use effort mode
function budgetToEffort(budget: number): ThinkingEffort {
  if (budget <= 0) return "none"
  if (budget <= 4096) return "low"
  if (budget <= 12288) return "medium"
  if (budget <= 24576) return "high"
  return "xhigh"
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ProviderOptions = Record<string, JSONObject>

export interface ThinkingConfig {
  enabled: boolean
  effort: ThinkingEffort
  /** Token budget for budget-mode models (derived from effort if not set) */
  budgetTokens: number
}

/**
 * Get the thinking capability for a model.
 * Supports provider-prefixed IDs (e.g. "opencode/qwen3.6-plus") and
 * date-suffixed IDs (e.g. "claude-sonnet-4-6-20250514").
 */
export function getModelCapability(modelId: string): ThinkingCapability {
  // Strip provider prefix if present (e.g. "opencode/qwen3.6-plus" → "qwen3.6-plus")
  const bareModel = modelId.includes("/") ? modelId.split("/").pop()! : modelId

  // Exact match first
  if (MODEL_CAPABILITIES[bareModel]) return MODEL_CAPABILITIES[bareModel]

  // Prefix match (handles date-suffixed IDs like claude-sonnet-4-6-20250514)
  for (const [key, cap] of Object.entries(MODEL_CAPABILITIES)) {
    if (bareModel.startsWith(key)) return cap
  }

  return null
}

/**
 * Check if a model requires `reasoning_content` on replayed assistant messages.
 * Data-driven — uses the MODEL_CAPABILITIES dictionary.
 */
export function needsReasoningReplay(modelId: string): boolean {
  const cap = getModelCapability(modelId)
  return cap?.requiresReasoningReplay === true
}

/**
 * Get the available effort levels for a model's UI.
 * Always includes "none" as the first element (off state).
 * Returns null if the model doesn't support thinking.
 */
export function getThinkingLevels(modelId: string): ThinkingEffort[] | null {
  const cap = getModelCapability(modelId)
  if (!cap) return null
  if (cap.mode === "budget") return ["none", "low", "medium", "high", "xhigh"]
  if (cap.mode === "adaptive") return ["none", ...cap.efforts]
  if (cap.mode === "effort") return cap.efforts // already includes "none"
  if (cap.mode === "native") return ["none", "high"] // TODO: map thinking levels to provider-specific params (enable_thinking + thinking_budget)
  return null
}

/**
 * ThinkingNormalizer — produces providerOptions for streamText()
 */
export class ThinkingNormalizer {
  private config: ThinkingConfig
  private modelId: string

  constructor(modelId: string, config?: Partial<ThinkingConfig>) {
    this.modelId = modelId
    this.config = {
      enabled: config?.enabled ?? false,
      effort: config?.effort ?? "medium",
      budgetTokens: config?.budgetTokens ?? 8192,
    }
  }

  /** Update thinking configuration */
  configure(config: Partial<ThinkingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** Get current thinking config */
  getConfig(): ThinkingConfig {
    return { ...this.config }
  }

  /**
   * Normalize thinking config into provider-specific options.
   * Returns undefined if thinking is disabled or model doesn't support it.
   */
  normalize(providerId: string): ProviderOptions | undefined {
    if (!this.config.enabled || this.config.effort === "none") {
      return undefined
    }

    const cap = getModelCapability(this.modelId)
    if (!cap) return undefined

    switch (cap.mode) {
      case "adaptive":
        return this.normalizeAdaptive(providerId)
      case "budget":
        return this.normalizeBudget(providerId)
      case "effort":
        return this.normalizeEffort(providerId)
      case "native":
        return this.normalizeNative(providerId)
      default:
        return undefined
    }
  }

  // -----------------------------------------------------------------------
  // Normalizers per capability mode
  // -----------------------------------------------------------------------

  private normalizeAdaptive(providerId: string): ProviderOptions | undefined {
    // Claude adaptive: { thinking: { type: "adaptive" }, effort: "low" }
    // The effort param is top-level in the Anthropic API
    return {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: this.config.effort,
      } as JSONObject,
    }
  }

  private normalizeBudget(providerId: string): ProviderOptions | undefined {
    const budget = EFFORT_TO_BUDGET[this.config.effort] ?? 8192
    if (budget < 1024) return undefined

    return {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: budget },
      } as JSONObject,
    }
  }

  private normalizeEffort(providerId: string): ProviderOptions | undefined {
    return {
      openai: {
        reasoningEffort: this.config.effort,
        reasoningSummary: "auto",
      } as JSONObject,
    }
  }

  private normalizeNative(providerId: string): ProviderOptions | undefined {
    // OpenAI-compatible endpoint serving a Qwen model
    // @ai-sdk/openai spreads providerOptions.openai directly into the request body
    return {
      openai: {
        enable_thinking: true,
      } as JSONObject,
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton for session-level thinking state
// ---------------------------------------------------------------------------

let _normalizer: ThinkingNormalizer | undefined
let _currentModelId = ""

export function getThinkingNormalizer(modelId?: string): ThinkingNormalizer {
  if (!_normalizer || (modelId && modelId !== _currentModelId)) {
    const prior = _normalizer?.getConfig()
    _currentModelId = modelId || _currentModelId
    _normalizer = new ThinkingNormalizer(_currentModelId, prior)
  }
  return _normalizer
}

export function resetThinkingNormalizer(): void {
  _normalizer = undefined
  _currentModelId = ""
}
