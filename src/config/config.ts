// Config loader — reads ~/.config/quark/config.yaml
//
// Model-related keys live alongside profile config in the same YAML file:
//   models:      [claude-sonnet-4.5, gpt-4o, ...]  # user's curated favorites (shown in /model picker)
//   main_model:  claude-sonnet-4.5                  # main agent loop
//   small_model: gpt-4o-mini                        # lightweight tasks (title generation, etc.)
//
// Provider is always embedded in the model string as "provider/model".
//
// Missing file or fields fall back to sensible defaults.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse as parseYAML, stringify as stringifyYAML } from "yaml"

const CONFIG_DIR = path.join(os.homedir(), ".config", "quark")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml")

export const CONFIG_PATH = CONFIG_FILE

export interface BranchingConfig {
  /** Fraction of the model's context window at which auto-branching triggers. */
  threshold: number
  /** Enable auto-branching on context pressure. */
  auto: boolean
}

const BRANCHING_DEFAULTS: BranchingConfig = {
  threshold: 0.90,
  auto: true,
}

// ---------------------------------------------------------------------------
// Provider config — user-defined OpenAI-compatible providers
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Base URL for the OpenAI-compatible API (e.g. "http://localhost:11434/v1") */
  baseURL: string
  /** API key — literal string or "env:VAR_NAME" to read from environment */
  apiKey: string
}

// ---------------------------------------------------------------------------
// Goal config — /goal command settings
// ---------------------------------------------------------------------------

export interface GoalConfig {
  explore_budget: number
  max_planned_tasks: number
  judge_model?: string
  planner_profile?: string
  executor_profile?: string
  verbose?: boolean
}

const GOAL_DEFAULTS: GoalConfig = {
  explore_budget: 5,
  max_planned_tasks: 20,
}

// ---------------------------------------------------------------------------
// QuarkConfig — top-level config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  models: [
    "gpt-4o",
    "gpt-4o-mini",
    "claude-sonnet-4",
    "claude-haiku-3.5",
    "gemini-2.5-pro",
    "o4-mini",
  ] as readonly string[],
  small_model: "gpt-4o-mini",
  main_model: "gpt-4o",
  max_steps: 100,
  branching: BRANCHING_DEFAULTS,
  providers: {} as Record<string, ProviderConfig>,
  hide_readonly_tools: false,
} as const

export interface QuarkConfig {
  models: string[]
  small_model: string
  main_model: string
  max_steps: number
  branching: BranchingConfig
  /** User-defined OpenAI-compatible providers (keyed by provider ID) */
  providers: Record<string, ProviderConfig>
  /** Hide read-only tool calls (read, grep, glob, websearch, webfetch, etc.) from the conversation view */
  hide_readonly_tools: boolean
  /** /goal command settings */
  goal?: GoalConfig
}

// Cached config — loaded once, reused thereafter
let cached: QuarkConfig | null = null

// Runtime-registered providers — added by plugins, not from config.yaml
const runtimeProviders: Record<string, ProviderConfig> = {}

function readRawConfig(): Record<string, unknown> {
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    const raw = parseYAML(content) as Record<string, unknown>
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

function parseGoalConfig(raw: unknown): GoalConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const r = raw as Record<string, unknown>
  return {
    explore_budget:
      typeof r.explore_budget === "number" && r.explore_budget > 0
        ? r.explore_budget
        : GOAL_DEFAULTS.explore_budget,
    max_planned_tasks:
      typeof r.max_planned_tasks === "number" && r.max_planned_tasks > 0
        ? r.max_planned_tasks
        : GOAL_DEFAULTS.max_planned_tasks,
    judge_model: typeof r.judge_model === "string" ? r.judge_model : undefined,
    planner_profile: typeof r.planner_profile === "string" ? r.planner_profile : undefined,
    executor_profile: typeof r.executor_profile === "string" ? r.executor_profile : undefined,
    verbose: typeof r.verbose === "boolean" ? r.verbose : undefined,
  }
}

function parseBranchingConfig(raw: unknown): BranchingConfig {
  if (!raw || typeof raw !== "object") return { ...BRANCHING_DEFAULTS }
  const r = raw as Record<string, unknown>
  return {
    threshold:
      typeof r.threshold === "number" && r.threshold > 0 && r.threshold <= 1
        ? r.threshold
        : BRANCHING_DEFAULTS.threshold,
    auto: typeof r.auto === "boolean" ? r.auto : BRANCHING_DEFAULTS.auto,
  }
}

function parseProviders(raw: unknown): Record<string, ProviderConfig> {
  if (!raw || typeof raw !== "object") return {}
  const result: Record<string, ProviderConfig> = {}
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue
    const v = val as Record<string, unknown>
    if (typeof v.baseURL !== "string" || !v.baseURL) continue
    result[id] = {
      baseURL: v.baseURL,
      apiKey: typeof v.apiKey === "string" ? v.apiKey : "",
    }
  }
  return result
}

/**
 * Resolve an apiKey value. If it starts with "env:", read from the environment.
 * Otherwise return the literal string.
 */
export function resolveApiKey(raw: string): string {
  if (raw.startsWith("env:")) {
    return process.env[raw.slice(4)] ?? ""
  }
  return raw
}

/**
 * Load config from disk. Returns defaults for any missing or invalid fields.
 * Never throws — config is best-effort.
 */
export function loadConfig(): QuarkConfig {
  if (cached) return cached

  const raw = readRawConfig()

  const config: QuarkConfig = {
    models:
      Array.isArray(raw.models) && raw.models.every((m: unknown) => typeof m === "string")
        ? (raw.models as string[])
        : [...DEFAULTS.models],
    small_model:
      typeof raw.small_model === "string" && raw.small_model
        ? raw.small_model
        : DEFAULTS.small_model,
    main_model:
      typeof raw.main_model === "string" && raw.main_model
        ? raw.main_model
        : DEFAULTS.main_model,
    max_steps:
      typeof raw.max_steps === "number" ? raw.max_steps : DEFAULTS.max_steps,
    branching: parseBranchingConfig(raw.branching),
    providers: parseProviders(raw.providers),
    hide_readonly_tools:
      typeof raw.hide_readonly_tools === "boolean"
        ? raw.hide_readonly_tools
        : DEFAULTS.hide_readonly_tools,
    goal: parseGoalConfig(raw.goal),
  }

  cached = config
  return config
}

/**
 * Parse a possibly-namespaced model spec like "copilot/claude-sonnet-4.6"
 * into { provider, model }. If no "/" is present, provider is undefined.
 */
export function parseModelSpec(spec: string): { provider?: string; model: string } {
  const idx = spec.indexOf("/")
  if (idx === -1) return { model: spec }
  return { provider: spec.slice(0, idx), model: spec.slice(idx + 1) }
}

/**
 * Look up a provider's config by ID.
 * Checks runtime-registered providers first (added by plugins), then config.yaml.
 * Returns null if not defined in either.
 */
export function getProviderConfig(id: string): ProviderConfig | null {
  if (runtimeProviders[id]) return runtimeProviders[id]!
  const config = loadConfig()
  return config.providers[id] ?? null
}

/**
 * Register a provider at runtime (e.g. from a plugin).
 * Takes precedence over config.yaml providers for the same ID.
 * Does NOT persist to disk.
 */
export function registerProvider(id: string, config: ProviderConfig): void {
  runtimeProviders[id] = config
}

/**
 * Update a config field and persist to disk.
 * Merges with existing config — only overwrites the specified field.
 */
export function setConfigField<K extends keyof QuarkConfig>(
  key: K,
  value: QuarkConfig[K],
): void {
  const raw = readRawConfig()

  raw[key] = value
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, stringifyYAML(raw), "utf-8")

  // Invalidate cache so next read picks up the change
  cached = null
}

/**
 * Clear cached config — useful if config file changes at runtime.
 */
export function resetConfigCache(): void {
  cached = null
}
