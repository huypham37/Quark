// ACP session config options: model + thinking-effort selectors (Zed Agent
// Panel integration).
//
// Advertises the configured models as a `select` config option with
// `category: "model"` and, for models the runner actually supports reasoning
// on, a thinking-effort `select` with `category: "thought_level"`. Both are
// rendered by Zed as dropdowns. `session/set_config_option` updates the
// per-session override stored in the session bridge; the bridge threads the
// model into `runner.prompt({ model })` and the effort into
// `runner.prompt({ thinkingEffort })` so each turn uses the selection.
//
// The host passes the available models and the agent's default model/effort at
// startup. This module never reads config or the catalog; it only builds
// protocol objects from what it is given. Effort levels come from the model's
// `thinkingLevels` (its verified catalog reasoning options), so an unsupported
// model advertises no effort option rather than a fabricated one.

import { methods, RequestError } from "@agentclientprotocol/sdk"
import type {
  AgentApp,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk"
import type { SessionBridge } from "./sessions"

export const MODEL_CONFIG_ID = "model"
export const EFFORT_CONFIG_ID = "effort"

/** A model the host makes available for selection. */
export interface ModelOption {
  /** Model spec in `provider/model` form, e.g. `"openai/gpt-5.6-luna"`. */
  id: string
  /** Human-readable display name, e.g. `"GPT-5.6 Luna"`. */
  name: string
  /** Provider display name for grouping, e.g. `"OpenAI"`. */
  providerName?: string
  /** Provider ID for grouping key, e.g. `"openai"`. */
  providerId?: string
  /** Short description. */
  description?: string
  /**
   * Thinking-effort levels this model actually accepts, from the runner's
   * catalog facts. Omitted or a single level means no effort selector is
   * advertised — never invent a level the runner would reject.
   */
  thinkingLevels?: readonly string[]
}

export interface ConfigOptionsContext {
  /** Available models. Empty means no config option is advertised. */
  models: readonly ModelOption[]
  /** The agent's default model spec (used as initial `currentValue`). */
  defaultModel: string
  /** The agent's default thinking effort, when it has one. */
  defaultEffort?: string
  /** Session bridge for get/set model + effort overrides. */
  sessions: SessionBridge
}

/** Display labels for the well-known effort levels; unknown levels fall back to capitalized. */
const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  thinking: "Thinking",
}

function effortLabel(level: string): string {
  return EFFORT_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1)
}

function levelsForModel(models: readonly ModelOption[], modelId: string): readonly string[] {
  return models.find((model) => model.id === modelId)?.thinkingLevels ?? []
}

/**
 * Build the `SessionConfigOption[]` for a session, reflecting its current
 * model and effort selection. Returns an empty array when no models are
 * configured (the composition root must not advertise config options then).
 */
export function buildConfigOptions(
  models: readonly ModelOption[],
  currentModel: string,
  currentEffort?: string,
): SessionConfigOption[] {
  if (models.length === 0) return []

  // Group models by provider for a cleaner picker UX.
  const groups = new Map<string, { name: string; options: SessionConfigSelectOption[] }>()
  for (const model of models) {
    const groupKey = model.providerId ?? "other"
    const groupName = model.providerName ?? "Other"
    let group = groups.get(groupKey)
    if (!group) {
      group = { name: groupName, options: [] }
      groups.set(groupKey, group)
    }
    group.options.push({
      value: model.id,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
    })
  }

  // Use grouped options when there are multiple providers; flat otherwise.
  const selectOptions: SessionConfigSelectGroup[] | SessionConfigSelectOption[] =
    groups.size > 1
      ? Array.from(groups.entries()).map(
          ([groupId, group]): SessionConfigSelectGroup => ({
            group: groupId,
            name: group.name,
            options: group.options,
          }),
        )
      : models.map(
          (m): SessionConfigSelectOption => ({
            value: m.id,
            name: m.name,
            ...(m.description ? { description: m.description } : {}),
          }),
        )

  const options: SessionConfigOption[] = [
    {
      type: "select" as const,
      id: MODEL_CONFIG_ID,
      name: "Model",
      category: "model" as const,
      currentValue: currentModel,
      options: selectOptions,
    },
  ]

  // Effort: only when the current model exposes more than one verified level
  // ("none" alone is not a meaningful choice).
  const levels = levelsForModel(models, currentModel)
  if (levels.length > 1) {
    const current: string =
      currentEffort && levels.includes(currentEffort)
        ? currentEffort
        : levels.includes("none")
          ? "none"
          : (levels[0] ?? "none")
    options.push({
      type: "select" as const,
      id: EFFORT_CONFIG_ID,
      name: "Effort",
      category: "thought_level" as const,
      currentValue: current,
      options: levels.map((level) => ({ value: level, name: effortLabel(level) })),
    })
  }

  return options
}

/**
 * Register the `session/set_config_option` handler on the ACP app.
 * Supports the `"model"` and `"effort"` config options.
 */
export function registerConfigOptions(app: AgentApp, context: ConfigOptionsContext): void {
  app.onRequest(methods.agent.session.setConfigOption, ({ params }) =>
    handleSetConfigOption(params, context),
  )
}

/** The options to report back for a session, resolved from its overrides. */
function optionsFor(context: ConfigOptionsContext, sessionId: string): SessionConfigOption[] {
  const model = context.sessions.getModelOverride(sessionId) ?? context.defaultModel
  const effort = context.sessions.getEffortOverride(sessionId) ?? context.defaultEffort
  return buildConfigOptions(context.models, model, effort)
}

function handleSetConfigOption(
  params: SetSessionConfigOptionRequest,
  context: ConfigOptionsContext,
): SetSessionConfigOptionResponse {
  const { sessionId } = params
  if (params.configId === MODEL_CONFIG_ID) {
    if (typeof params.value !== "string") {
      throw RequestError.invalidParams({ value: params.value }, "model value must be a model id")
    }
    const modelId = params.value
    // Validate that the requested model is in the available list.
    if (!context.models.some((m) => m.id === modelId)) {
      throw RequestError.invalidParams({ value: modelId }, `unknown model "${modelId}"`)
    }

    context.sessions.setModelOverride(sessionId, modelId)
    // A model switch can invalidate the current effort: drop an override the
    // new model cannot accept rather than letting the next turn throw.
    const effort = context.sessions.getEffortOverride(sessionId)
    if (effort && !levelsForModel(context.models, modelId).includes(effort)) {
      context.sessions.setEffortOverride(sessionId, null)
    }
    return { configOptions: optionsFor(context, sessionId) }
  }

  if (params.configId === EFFORT_CONFIG_ID) {
    if (typeof params.value !== "string") {
      throw RequestError.invalidParams({ value: params.value }, "effort value must be a level id")
    }
    const modelId = context.sessions.getModelOverride(sessionId) ?? context.defaultModel
    const levels = levelsForModel(context.models, modelId)
    if (levels.length <= 1) {
      throw RequestError.invalidParams(
        { configId: params.configId },
        `model "${modelId}" does not support thinking effort`,
      )
    }
    if (!levels.includes(params.value)) {
      throw RequestError.invalidParams(
        { value: params.value },
        `unknown effort "${params.value}" for model "${modelId}"`,
      )
    }
    context.sessions.setEffortOverride(sessionId, params.value)
    return { configOptions: optionsFor(context, sessionId) }
  }

  throw RequestError.invalidParams(
    { configId: params.configId },
    `unknown config option "${params.configId}"; supported: "${MODEL_CONFIG_ID}", "${EFFORT_CONFIG_ID}"`,
  )
}
