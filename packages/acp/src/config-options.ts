// ACP session config options: profile + model + thinking-effort selectors (Zed
// Agent Panel integration).
//
// Three `select` options, each one per-session setting the client may change at
// any time through `session/set_config_option`:
//
//   * `profile` (category "mode") — which profile (agent manifest) the session
//     runs. This is ACP's mode selector, so an editor renders it as a dropdown
//     and switching it rebinds the session's runner: new tools, system prompt,
//     skills, and the profile's own model/effort, on the same persisted
//     history. `quark acp --profile <id>` picks the one sessions start on.
//   * `model` (category "model")
//   * `effort` (category "thought_level")
//
// A session's effective selection resolves in one order — explicit pick, then
// the selected profile's own setting, then the connection default — so a
// profile switch is visible in the model and effort rows instead of leaving
// them stale. Switching profile drops the session's explicit model/effort
// picks: "switch to this profile" means "run it as configured". The bridge
// threads the picks into `runner.prompt({ model, thinkingEffort })`.
//
// The host passes the available profiles/models and the connection defaults at
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

export const PROFILE_CONFIG_ID = "profile"
export const MODEL_CONFIG_ID = "model"
export const EFFORT_CONFIG_ID = "effort"

/** A profile (agent manifest) the host makes available for selection. */
export interface ProfileOption {
  /** Profile id (manifest file stem), e.g. `"coder"`. */
  id: string
  /** Human-readable display name, e.g. `"Coder"`. */
  name: string
  /** Short description. */
  description?: string
  /**
   * The profile's own model spec. While this profile is selected and the
   * session has no explicit model pick, this is the `model` option's value —
   * the picker never shows a model the next turn will not use.
   */
  model?: string
  /** The profile's own thinking effort, resolved the same way as `model`. */
  thinkingEffort?: string
}

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

/** The connection defaults, from the launch-time profile and its agent. */
export interface ConfigOptionDefaults {
  /**
   * Profile new sessions start on. Must be one of the advertised `profiles`
   * when any are advertised: it is the profile option's initial value.
   */
  profile?: string
  /** Model used when the selected profile names none. */
  model: string
  /** Thinking effort used when the selected profile names none. */
  effort?: string
}

/** Explicit per-session selections; absent or null means "not chosen". */
export interface ConfigOptionOverrides {
  profile?: string | null
  model?: string | null
  effort?: string | null
}

/** Everything needed to build one session's config options. */
export interface ConfigOptionsInput {
  models: readonly ModelOption[]
  profiles: readonly ProfileOption[]
  /** The session's explicit picks, if it has any. */
  overrides?: ConfigOptionOverrides
  defaults: ConfigOptionDefaults
}

export interface ConfigOptionsContext {
  /** Available models. Empty means no model/effort option is advertised. */
  models: readonly ModelOption[]
  /** Available profiles. Empty means no profile option is advertised. */
  profiles: readonly ProfileOption[]
  defaults: ConfigOptionDefaults
  /** Session bridge for get/set profile + model + effort overrides. */
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
 * The model a session actually runs, resolved in one order: the session's
 * explicit pick, the selected profile's own model, the connection default.
 * Exported so a host can gate host-side behavior (accepting image prompts) on
 * the same model the next turn will use.
 */
export function effectiveModel(input: {
  profiles: readonly ProfileOption[]
  defaults: ConfigOptionDefaults
  overrides?: ConfigOptionOverrides
}): string {
  return input.overrides?.model ?? selectedProfile(input)?.model ?? input.defaults.model
}

/**
 * The profile a session runs: its explicit pick, else the connection default.
 * A selection no advertised profile backs falls back to the first one — the host
 * advertises the same set it can bind, and the pickers must not show a value
 * they do not offer.
 */
function selectedProfile(input: {
  profiles: readonly ProfileOption[]
  defaults: ConfigOptionDefaults
  overrides?: ConfigOptionOverrides
}): ProfileOption | undefined {
  const id = input.overrides?.profile ?? input.defaults.profile
  return input.profiles.find((profile) => profile.id === id) ?? input.profiles[0]
}

/**
 * Build the `SessionConfigOption[]` for one session from its live selections:
 * the profile (ACP's mode selector), the model, and — for models the runner
 * actually supports reasoning on — the thinking effort. Returns an empty array
 * when the host offers neither profiles nor models, so the composition root
 * must not advertise config options then.
 */
export function buildConfigOptions(input: ConfigOptionsInput): SessionConfigOption[] {
  const { models, profiles } = input
  const options: SessionConfigOption[] = []

  // Profile first: the base selection the model and effort resolve against.
  const profile = selectedProfile(input)
  if (profile) {
    options.push({
      type: "select" as const,
      id: PROFILE_CONFIG_ID,
      name: "Profile",
      category: "mode" as const,
      currentValue: profile.id,
      options: profiles.map(
        (option): SessionConfigSelectOption => ({
          value: option.id,
          name: option.name,
          ...(option.description ? { description: option.description } : {}),
        }),
      ),
    })
  }

  if (models.length === 0) return options

  const currentModel = effectiveModel(input)

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

  options.push({
    type: "select" as const,
    id: MODEL_CONFIG_ID,
    name: "Model",
    category: "model" as const,
    currentValue: currentModel,
    options: selectOptions,
  })

  // Effort: only when the current model exposes more than one verified level
  // ("none" alone is not a meaningful choice).
  const levels = levelsForModel(models, currentModel)
  if (levels.length > 1) {
    const picked = input.overrides?.effort ?? profile?.thinkingEffort ?? input.defaults.effort
    const current: string =
      picked && levels.includes(picked)
        ? picked
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
 * Supports the `"profile"`, `"model"` and `"effort"` config options.
 */
export function registerConfigOptions(app: AgentApp, context: ConfigOptionsContext): void {
  app.onRequest(methods.agent.session.setConfigOption, ({ params }) =>
    handleSetConfigOption(params, context),
  )
}

/** A session's explicit picks, straight from the bridge. */
function overridesOf(context: ConfigOptionsContext, sessionId: string): ConfigOptionOverrides {
  return {
    profile: context.sessions.getProfileOverride(sessionId),
    model: context.sessions.getModelOverride(sessionId),
    effort: context.sessions.getEffortOverride(sessionId),
  }
}

/** The options to report back for a session, resolved from its live picks. */
function optionsFor(context: ConfigOptionsContext, sessionId: string): SessionConfigOption[] {
  return buildConfigOptions({
    models: context.models,
    profiles: context.profiles,
    defaults: context.defaults,
    overrides: overridesOf(context, sessionId),
  })
}

/** The config ids this context can advertise, for error messages. */
function supportedConfigIds(context: ConfigOptionsContext): string[] {
  return [
    ...(context.profiles.length > 0 ? [PROFILE_CONFIG_ID] : []),
    ...(context.models.length > 0 ? [MODEL_CONFIG_ID, EFFORT_CONFIG_ID] : []),
  ]
}

function handleSetConfigOption(
  params: SetSessionConfigOptionRequest,
  context: ConfigOptionsContext,
): SetSessionConfigOptionResponse {
  const { sessionId } = params

  if (params.configId === PROFILE_CONFIG_ID) {
    if (typeof params.value !== "string") {
      throw RequestError.invalidParams({ value: params.value }, "profile value must be a profile id")
    }
    const profileId = params.value
    // Validate that the requested profile is in the available list.
    if (!context.profiles.some((profile) => profile.id === profileId)) {
      throw RequestError.invalidParams({ value: profileId }, `unknown profile "${profileId}"`)
    }

    // The profile decides the runner's agent (tools, system prompt, skills, its
    // own model), so the bridge drops the cached runner and refuses this while a
    // turn is in progress.
    context.sessions.setProfileOverride(sessionId, profileId)
    // "Switch to this profile" means "run it as configured": drop the session's
    // explicit model/effort picks so the new profile's own settings apply
    // instead of the previous profile's selections shadowing them.
    context.sessions.setModelOverride(sessionId, null)
    context.sessions.setEffortOverride(sessionId, null)
    return { configOptions: optionsFor(context, sessionId) }
  }

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
    // Resolve the model this session will actually run: the effort has to be one
    // that model accepts, whatever selected it (the model picker, the profile's
    // own model, or the connection default).
    const modelId = effectiveModel({
      profiles: context.profiles,
      defaults: context.defaults,
      overrides: overridesOf(context, sessionId),
    })
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

  const supported = supportedConfigIds(context).map((id) => `"${id}"`).join(", ")
  throw RequestError.invalidParams(
    { configId: params.configId },
    `unknown config option "${params.configId}"; supported: ${supported}`,
  )
}
