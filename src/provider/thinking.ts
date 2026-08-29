import type { JSONObject } from "@ai-sdk/provider"
import { getThinkingCapability, type ThinkingCapability } from "./catalog"

export type ProviderOptions = Record<string, JSONObject>
export type ThinkingEffort = string

export interface ThinkingConfig {
  effort: string
  mode: string
  modeExplicit: boolean
}

type RequestShape = {
  effortField?: string
  enabledFields?: JSONObject
  disabledFields?: JSONObject
  modeField?: string
}

const OPENAI_REASONING: RequestShape = {
  effortField: "reasoningEffort",
  enabledFields: { reasoningSummary: "auto" },
}
const OPENAI_REASONING_MODE: RequestShape = {
  ...OPENAI_REASONING,
  modeField: "reasoningMode",
}
const BINARY_TOGGLE: RequestShape = { enabledFields: { enable_thinking: true } }

/** Local request-shape overlays. Capability policy lives in catalog.ts. */
const REQUEST_SHAPES: Record<string, RequestShape> = {
  "claude-opus-4-7": { effortField: "effort", enabledFields: { thinking: { type: "adaptive" } } },
  "claude-opus-4-6": { effortField: "effort", enabledFields: { thinking: { type: "adaptive" } } },
  "claude-sonnet-4-6": { effortField: "effort", enabledFields: { thinking: { type: "adaptive" } } },
  "gpt-5": OPENAI_REASONING,
  "gpt-5.5": OPENAI_REASONING,
  "gpt-5.5-pro": OPENAI_REASONING,
  "gpt-5.4": OPENAI_REASONING,
  "gpt-5.4-pro": OPENAI_REASONING,
  "gpt-5.2": OPENAI_REASONING,
  "gpt-5-mini": OPENAI_REASONING,
  "gpt-5-nano": OPENAI_REASONING,
  "o4-mini": OPENAI_REASONING,
  o3: OPENAI_REASONING,
  o1: OPENAI_REASONING,
  "gpt-5.6": OPENAI_REASONING_MODE,
  "gpt-5.6-sol": OPENAI_REASONING_MODE,
  "gpt-5.6-terra": OPENAI_REASONING_MODE,
  "gpt-5.6-luna": OPENAI_REASONING_MODE,
  "qwen-max": BINARY_TOGGLE,
  "qwen-plus": BINARY_TOGGLE,
  "qwen-turbo": BINARY_TOGGLE,
  "qwen3-max": BINARY_TOGGLE,
  "qwen3-plus": BINARY_TOGGLE,
  "qwen3.6-plus": BINARY_TOGGLE,
  "qwen3.6": BINARY_TOGGLE,
  "minimax-m2.7": BINARY_TOGGLE,
  "glm-5.1": BINARY_TOGGLE,
  "kimi-": { enabledFields: { thinking: { type: "enabled" } } },
  "deepseek-": {
    effortField: "reasoningEffort",
    enabledFields: { thinking: { type: "enabled" } },
    disabledFields: { thinking: { type: "disabled" } },
  },
}

function bareModelId(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId
}

function requestShape(modelId: string): RequestShape | null {
  const bare = bareModelId(modelId)
  if (REQUEST_SHAPES[bare]) return REQUEST_SHAPES[bare]!
  for (const [prefix, shape] of Object.entries(REQUEST_SHAPES)) {
    if (bare.startsWith(prefix)) return shape
  }
  return null
}

export function getThinkingLevels(modelId: string): string[] | null {
  return getThinkingCapability(modelId)?.levels ?? null
}

export function getThinkingModes(modelId: string): string[] | null {
  return getThinkingCapability(modelId)?.modes ?? null
}

export function validateThinkingEffort(modelId: string, effort: string): void {
  const levels = getThinkingLevels(modelId)
  if (!levels) throw new Error(`Thinking is not supported by model "${modelId}".`)
  if (!levels.includes(effort)) {
    throw new Error(
      `Invalid thinking effort "${effort}" for model "${modelId}". Supported efforts: ${levels.join(", ")}.`,
    )
  }
}

export function getDefaultThinkingEffort(modelId: string): string {
  const levels = getThinkingLevels(modelId)
  return levels?.includes("none") ? "none" : levels?.[0] ?? "none"
}

export function buildProviderOptions(input: {
  providerOptionsKey: string
  modelId: string
  modelCapability?: ThinkingCapability | null
  thinkingConfig: ThinkingConfig
}): ProviderOptions | undefined {
  const { thinkingConfig } = input
  const shape = requestShape(input.modelId)
  if (thinkingConfig.effort === "none") {
    return shape?.disabledFields
      ? { [input.providerOptionsKey]: { ...shape.disabledFields } }
      : undefined
  }

  const capability = input.modelCapability ?? getThinkingCapability(input.modelId)
  if (!capability || !shape) return undefined
  if (!capability.levels.includes(thinkingConfig.effort)) {
    throw new Error(
      `Invalid thinking effort "${thinkingConfig.effort}" for model "${input.modelId}". Supported efforts: ${capability.levels.join(", ")}.`,
    )
  }

  if (!shape.modeField) {
    if (thinkingConfig.modeExplicit) {
      throw new Error(
        `thinking_mode is not supported by model "${input.modelId}". Remove thinking_mode or choose a model that supports modes.`,
      )
    }
  } else {
    const mode = thinkingConfig.mode || capability.defaultMode
    if (!mode || !capability.modes?.includes(mode)) {
      throw new Error(
        `Invalid thinking_mode "${mode}" for model "${input.modelId}". Supported modes: ${capability.modes?.join(", ")}.`,
      )
    }
  }

  const options = { ...shape.enabledFields } as JSONObject
  if (shape.effortField) options[shape.effortField] = thinkingConfig.effort
  if (shape.modeField) options[shape.modeField] = thinkingConfig.mode || capability.defaultMode
  return { [input.providerOptionsKey]: options }
}

/** Stateless compatibility facade. Prefer buildProviderOptions. */
export class ThinkingNormalizer {
  private config: ThinkingConfig

  constructor(private readonly modelId: string, config: Partial<ThinkingConfig> = {}) {
    this.config = {
      effort: config.effort ?? "none",
      mode: config.mode ?? "standard",
      modeExplicit: config.modeExplicit ?? false,
    }
  }

  configure(config: Partial<ThinkingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): ThinkingConfig {
    return { ...this.config }
  }

  normalize(providerOptionsKey: string): ProviderOptions | undefined {
    return buildProviderOptions({
      providerOptionsKey,
      modelId: this.modelId,
      thinkingConfig: this.config,
    })
  }
}
