// Profile system — profile-driven agent identity
//
// A profile defines an agent's identity:
//   - A system prompt (read from a .md file)
//   - A strict set of tools
//   - A strict set of skills
//
// Profiles are configured in YAML config files:
//   - .atom/config.yaml  (project-level, overrides global)
//   - ~/.atom/config.yaml (global)
//
// Profile resolution order:
//   1. Explicit --profile flag / SDK parameter (deterministic)
//   2. Default profile from config
//   3. Built-in "coder" fallback

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse as parseYAML } from "yaml"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileDef {
  /** Unique profile id (e.g. "coder", "researcher") */
  id: string
  /** Human-readable name */
  name: string
  /** Path to system prompt .md file (relative to config dir or absolute) */
  promptFile: string
  /** Tool IDs this profile can use */
  tools: string[]
  /** Skill names this profile has access to (L1 metadata loaded at activation) */
  skills: string[]
  /** Max loop iterations */
  maxSteps: number
  /** Token threshold for compaction */
  contextLimitTokens: number
}

export interface ProfileConfig {
  /** Default profile to activate when none specified */
  defaultProfile: string
  /** Profile definitions keyed by id */
  profiles: Record<string, ProfileDef>
}

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

const BUILTIN_CODER: ProfileDef = {
  id: "coder",
  name: "Coder",
  promptFile: "",
  tools: ["read", "write", "edit", "bash", "skill", "todo"],
  skills: [],
  maxSteps: 100,
  contextLimitTokens: 100_000,
}

const BUILTIN_PROMPT =
  "You are a coding assistant. Help the user with software engineering tasks."

// ---------------------------------------------------------------------------
// Config file locations
// ---------------------------------------------------------------------------

function projectConfigDir(): string {
  return path.resolve(process.cwd(), ".atom")
}

function globalConfigDir(): string {
  return path.join(os.homedir(), ".atom")
}

function configPaths(): string[] {
  return [
    path.join(globalConfigDir(), "config.yaml"),
    path.join(projectConfigDir(), "config.yaml"),
  ]
}

// ---------------------------------------------------------------------------
// YAML config parsing
// ---------------------------------------------------------------------------

function parseProfilesFromYAML(raw: Record<string, unknown>, configDir: string): Record<string, ProfileDef> {
  const profiles: Record<string, ProfileDef> = {}

  const rawProfiles = raw.profiles as Record<string, unknown> | undefined
  if (!rawProfiles || typeof rawProfiles !== "object") return profiles

  for (const [id, val] of Object.entries(rawProfiles)) {
    if (!val || typeof val !== "object") continue
    const p = val as Record<string, unknown>

    profiles[id] = {
      id,
      name: typeof p.name === "string" ? p.name : id,
      promptFile: typeof p.prompt_file === "string" ? resolvePromptPath(p.prompt_file, configDir) : "",
      tools: Array.isArray(p.tools) ? (p.tools as string[]) : BUILTIN_CODER.tools,
      skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
      maxSteps: typeof p.max_steps === "number" ? p.max_steps : BUILTIN_CODER.maxSteps,
      contextLimitTokens: typeof p.context_limit_tokens === "number" ? p.context_limit_tokens : BUILTIN_CODER.contextLimitTokens,
    }
  }

  return profiles
}

function resolvePromptPath(promptFile: string, configDir: string): string {
  if (path.isAbsolute(promptFile)) return promptFile
  return path.resolve(configDir, promptFile)
}

// ---------------------------------------------------------------------------
// Project-level overrides (skills_add, tools_add)
// ---------------------------------------------------------------------------

interface ProjectOverrides {
  skillsAdd: string[]
  toolsAdd: string[]
}

function parseProjectOverrides(raw: Record<string, unknown>, profileId: string): ProjectOverrides {
  const result: ProjectOverrides = { skillsAdd: [], toolsAdd: [] }

  const overrides = raw.profile_overrides as Record<string, unknown> | undefined
  if (!overrides || typeof overrides !== "object") return result

  const profileOverride = overrides[profileId] as Record<string, unknown> | undefined
  if (!profileOverride || typeof profileOverride !== "object") return result

  if (Array.isArray(profileOverride.skills_add)) {
    result.skillsAdd = profileOverride.skills_add as string[]
  }
  if (Array.isArray(profileOverride.tools_add)) {
    result.toolsAdd = profileOverride.tools_add as string[]
  }

  return result
}

// ---------------------------------------------------------------------------
// Load and merge configs
// ---------------------------------------------------------------------------

let configCache: ProfileConfig | null = null

export function loadProfileConfig(): ProfileConfig {
  if (configCache) return configCache

  let defaultProfile = "coder"
  const merged: Record<string, ProfileDef> = {}

  // Always include builtin coder as fallback
  merged[BUILTIN_CODER.id] = { ...BUILTIN_CODER }

  for (const configPath of configPaths()) {
    if (!fs.existsSync(configPath)) continue

    try {
      const content = fs.readFileSync(configPath, "utf-8")
      const raw = parseYAML(content) as Record<string, unknown>
      if (!raw || typeof raw !== "object") continue

      if (typeof raw.default_profile === "string") {
        defaultProfile = raw.default_profile
      }

      const configDir = path.dirname(configPath)
      const profiles = parseProfilesFromYAML(raw, configDir)

      // Later configs (project) override earlier ones (global)
      for (const [id, prof] of Object.entries(profiles)) {
        merged[id] = prof
      }
    } catch {
      // Skip invalid config files
    }
  }

  configCache = { defaultProfile, profiles: merged }
  return configCache
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a profile by id. If not found, falls back to default profile,
 * then to built-in coder. Applies project-level overrides (skills_add, tools_add).
 */
export function resolveProfile(profileId?: string): ProfileDef {
  const config = loadProfileConfig()
  const id = profileId ?? config.defaultProfile

  let profile = config.profiles[id]
  if (!profile) {
    profile = config.profiles[config.defaultProfile] ?? { ...BUILTIN_CODER }
  }

  // Apply project-level overrides
  const projectConfig = projectConfigDir()
  const projectYamlPath = path.join(projectConfig, "config.yaml")
  if (fs.existsSync(projectYamlPath)) {
    try {
      const content = fs.readFileSync(projectYamlPath, "utf-8")
      const raw = parseYAML(content) as Record<string, unknown>
      if (raw && typeof raw === "object") {
        const overrides = parseProjectOverrides(raw, profile.id)
        if (overrides.skillsAdd.length > 0 || overrides.toolsAdd.length > 0) {
          profile = {
            ...profile,
            skills: [...profile.skills, ...overrides.skillsAdd],
            tools: [...profile.tools, ...overrides.toolsAdd],
          }
        }
      }
    } catch {
      // Skip invalid overrides
    }
  }

  return profile
}

/**
 * Read the system prompt content from a profile's prompt file.
 * Returns the built-in default prompt if no file is configured or file is unreadable.
 */
export function readPromptFile(profile: ProfileDef): string {
  if (!profile.promptFile) return BUILTIN_PROMPT

  try {
    return fs.readFileSync(profile.promptFile, "utf-8").trim()
  } catch {
    return BUILTIN_PROMPT
  }
}

/**
 * List all available profile IDs.
 */
export function listProfiles(): string[] {
  const config = loadProfileConfig()
  return Object.keys(config.profiles)
}

/**
 * Clear cached config — call when config files change at runtime.
 */
export function resetProfileCache(): void {
  configCache = null
}

// ---------------------------------------------------------------------------
// Exported for testing only
// ---------------------------------------------------------------------------
export const _internal = {
  parseProfilesFromYAML,
  parseProjectOverrides,
  BUILTIN_CODER,
}
