// ACP session config options: model selector (Zed model-picker integration).
//
// Advertises the configured models as a `select` config option with
// `category: "model"`, which Zed renders as a model-picker dropdown in the
// Agent Panel. `session/set_config_option` updates the per-session model
// override stored in the session bridge; the bridge threads it into
// `runner.prompt({ model })` so each turn uses the selected model.
//
// The host passes the available models and the agent's default model spec at
// startup. This module never reads config or the catalog; it only builds
// protocol objects from what it is given.

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
}

export interface ConfigOptionsContext {
  /** Available models. Empty means no model config option is advertised. */
  models: readonly ModelOption[]
  /** The agent's default model spec (used as initial `currentValue`). */
  defaultModel: string
  /** Session bridge for get/set model overrides. */
  sessions: SessionBridge
}

/**
 * Build the `SessionConfigOption[]` for a session, reflecting its current
 * model selection.  Returns an empty array when no models are configured
 * (the composition root must not advertise config options in that case).
 */
export function buildConfigOptions(
  models: readonly ModelOption[],
  currentModel: string,
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

  return [
    {
      type: "select" as const,
      id: MODEL_CONFIG_ID,
      name: "Model",
      category: "model" as const,
      currentValue: currentModel,
      options: selectOptions,
    },
  ]
}

/**
 * Register the `session/set_config_option` handler on the ACP app.
 * Currently supports only the `"model"` config option.
 */
export function registerConfigOptions(app: AgentApp, context: ConfigOptionsContext): void {
  app.onRequest(methods.agent.session.setConfigOption, ({ params }) =>
    handleSetConfigOption(params, context),
  )
}

function handleSetConfigOption(
  params: SetSessionConfigOptionRequest,
  context: ConfigOptionsContext,
): SetSessionConfigOptionResponse {
  if (params.configId !== MODEL_CONFIG_ID) {
    throw RequestError.invalidParams(
      { configId: params.configId },
      `unknown config option "${params.configId}"; supported: "${MODEL_CONFIG_ID}"`,
    )
  }

  const modelId = params.value as string
  // Validate that the requested model is in the available list.
  if (!context.models.some((m) => m.id === modelId)) {
    throw RequestError.invalidParams({ value: modelId }, `unknown model "${modelId}"`)
  }

  context.sessions.setModelOverride(params.sessionId, modelId)
  return { configOptions: buildConfigOptions(context.models, modelId) }
}
