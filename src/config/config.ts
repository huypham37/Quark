// Config loader — reads ~/.config/atom/config.yaml
//
// Model-related keys live alongside profile config in the same YAML file:
//   models:      [claude-sonnet-4.5, gpt-4o, ...]  # user's curated favorites (shown in /model picker)
//   small_model: gpt-4o-mini                         # lightweight tasks (title generation, etc.)
//   main_model:  claude-sonnet-4.5                   # main agent loop
//
// Missing file or fields fall back to sensible defaults.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse as parseYAML, stringify as stringifyYAML } from "yaml"

const CONFIG_DIR = path.join(os.homedir(), ".config", "atom")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml")

// ---------------------------------------------------------------------------
// Compact config — nested under AtomConfig
// ---------------------------------------------------------------------------

export interface CompactConfig {
  /** Which compaction method to use. Default: "general" */
  method: string
  /** Number of recent user/assistant turn pairs to keep verbatim. Default: 5 */
  retain_turns: number
  /**
   * Fraction of the model's context window at which auto-compaction triggers.
   * e.g. 0.95 means compact when estimated tokens >= 95% of context_window.
   * Default: 0.95
   */
  threshold: number
  /** Enable auto-compaction. Default: true */
  auto: boolean
}

const COMPACT_DEFAULTS: CompactConfig = {
  method: "general",
  retain_turns: 5,
  threshold: 0.95,
  auto: true,
}

// ---------------------------------------------------------------------------
// AtomConfig — top-level config
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
  context_window: 100_000,
  compact: COMPACT_DEFAULTS,
} as const

export interface AtomConfig {
  models: string[]
  small_model: string
  main_model: string
  max_steps: number
  /** Fallback context window (tokens) when models.dev doesn't have the model. */
  context_window: number
  compact: CompactConfig
}

// Cached config — loaded once, reused thereafter
let cached: AtomConfig | null = null

function readRawConfig(): Record<string, unknown> {
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    const raw = parseYAML(content) as Record<string, unknown>
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

function parseCompactConfig(raw: unknown): CompactConfig {
  if (!raw || typeof raw !== "object") return { ...COMPACT_DEFAULTS }
  const r = raw as Record<string, unknown>
  return {
    method: typeof r.method === "string" && r.method ? r.method : COMPACT_DEFAULTS.method,
    retain_turns:
      typeof r.retain_turns === "number" && r.retain_turns > 0
        ? r.retain_turns
        : COMPACT_DEFAULTS.retain_turns,
    threshold:
      typeof r.threshold === "number" && r.threshold > 0 && r.threshold <= 1
        ? r.threshold
        : COMPACT_DEFAULTS.threshold,
    auto: typeof r.auto === "boolean" ? r.auto : COMPACT_DEFAULTS.auto,
  }
}

/**
 * Load config from disk. Returns defaults for any missing or invalid fields.
 * Never throws — config is best-effort.
 */
export function loadConfig(): AtomConfig {
  if (cached) return cached

  const raw = readRawConfig()

  cached = {
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
    context_window:
      typeof raw.context_window === "number" ? raw.context_window : DEFAULTS.context_window,
    compact: parseCompactConfig(raw.compact),
  }

  return cached
}

/**
 * Get the model ID for a given purpose.
 */
export function getModelId(kind: "main" | "small"): string {
  const config = loadConfig()
  return kind === "small" ? config.small_model : config.main_model
}

/**
 * Update a config field and persist to disk.
 * Merges with existing config — only overwrites the specified field.
 */
export function setConfigField<K extends keyof AtomConfig>(
  key: K,
  value: AtomConfig[K],
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
