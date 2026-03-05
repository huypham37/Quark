// Config loader — reads ~/.config/atom/config.json
//
// Schema:
//   {
//     "models":      ["gpt-4o", "claude-sonnet-4", ...], // user's curated favorite models (shown in /model picker)
//     "small_model": "gpt-4o-mini",                        // lightweight tasks (title generation, etc.)
//     "main_model":  "gpt-4o"                              // main agent loop
//   }
//
// Missing file or fields fall back to sensible defaults.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const CONFIG_DIR = path.join(os.homedir(), ".config", "atom")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")

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
} as const

export interface AtomConfig {
  models: string[]
  small_model: string
  main_model: string
}

// Cached config — loaded once, reused thereafter
let cached: AtomConfig | null = null

/**
 * Load config from disk. Returns defaults for any missing or invalid fields.
 * Never throws — config is best-effort.
 */
export function loadConfig(): AtomConfig {
  if (cached) return cached

  let raw: Record<string, unknown> = {}
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    raw = JSON.parse(content) as Record<string, unknown>
  } catch {
    // File missing or invalid JSON — use all defaults
  }

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
  // Read existing file (may have extra fields we don't know about)
  let raw: Record<string, unknown> = {}
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    raw = JSON.parse(content) as Record<string, unknown>
  } catch {
    // Start fresh
  }

  raw[key] = value
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2), "utf-8")

  // Invalidate cache so next read picks up the change
  cached = null
}

/**
 * Clear cached config — useful if config file changes at runtime.
 */
export function resetConfigCache(): void {
  cached = null
}
