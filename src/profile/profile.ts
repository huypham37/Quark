// Profile system — profile-driven agent identity
//
// A profile defines an agent's identity:
//   - A system prompt (read from a .md file)
//   - A strict set of tools
//   - A strict set of skills
//
// Profiles are configured in YAML config files:
//   - .quark/config.yaml  (project-level, overrides global)
//   - ~/.quark/config.yaml (global)
//
// Profile resolution order:
//   1. Explicit --profile flag / SDK parameter (deterministic)
//   2. Default profile from config
//   3. Built-in "coder" fallback

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse as parseYAML } from "yaml"
import { warn as notifyWarn } from "../notification/notification"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileDef {
  /** Unique profile id (e.g. "coder", "researcher") */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what this profile does (from prompt file frontmatter) */
  description?: string
  /** Path to system prompt .md file (relative to config dir or absolute) */
  promptFile: string
  /** Tool IDs this profile can use */
  tools: string[]
  /** Skill names this profile has access to (L1 metadata loaded at activation) */
  skills: string[]
  /** Profile IDs of sub-agents this profile can spawn */
  subAgents?: string[]
  /** Model to use for this profile (optional, falls back to config main_model) */
  model?: string
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
}

const BUILTIN_PROMPT =
  "You are a coding assistant. Help the user with software engineering tasks."

// ---------------------------------------------------------------------------
// Config file locations
// ---------------------------------------------------------------------------

function projectConfigDir(): string {
  return path.resolve(process.cwd(), ".quark")
}

function globalConfigDir(): string {
  return path.join(os.homedir(), ".config", "quark")
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
      subAgents: Array.isArray(p.sub_agents) ? (p.sub_agents as string[]) : undefined,
      model: typeof p.model === "string" ? p.model : undefined,
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
 * Validate a list of sub-agent IDs against the set of known profile IDs.
 * Returns the valid IDs and the unknown/invalid IDs separately.
 * Pure function — no side effects, safe to call from tests directly.
 */
export function validateSubAgents(
  subAgents: string[],
  knownProfileIds: string[],
): { valid: string[]; invalid: string[] } {
  const valid = subAgents.filter((id) => knownProfileIds.includes(id))
  const invalid = subAgents.filter((id) => !knownProfileIds.includes(id))
  return { valid, invalid }
}

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

  // Validate sub_agents — warn about IDs that don't match any known profile
  if (profile.subAgents && profile.subAgents.length > 0) {
    const knownIds = Object.keys(config.profiles)
    const { valid, invalid } = validateSubAgents(profile.subAgents, knownIds)
    if (invalid.length > 0) {
      notifyWarn(
        "Profile",
        `Unknown sub-agent${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. Available profiles: ${knownIds.join(", ")}`,
        8000,
      )
      profile = { ...profile, subAgents: valid }
    }
  }

  return profile
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (minimal YAML — just `key: value` lines)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const data: Record<string, string> = {}
  if (!raw.startsWith("---")) return { data, content: raw }

  const end = raw.indexOf("\n---", 3)
  if (end === -1) return { data, content: raw }

  const front = raw.substring(4, end) // skip "---\n"
  const content = raw.substring(end + 4).trim() // skip "\n---\n"

  for (const line of front.split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.substring(0, colon).trim()
    const val = line.substring(colon + 1).trim()
    data[key] = val
  }

  return { data, content }
}

export interface PromptFileResult {
  content: string
  name?: string
  description?: string
}

/**
 * Read the system prompt content from a profile's prompt file.
 * Parses YAML frontmatter for name and description if present.
 * Returns the built-in default prompt if no file is configured or file is unreadable.
 */
export function readPromptFile(profile: ProfileDef): PromptFileResult {
  if (!profile.promptFile) return { content: BUILTIN_PROMPT }

  try {
    const raw = fs.readFileSync(profile.promptFile, "utf-8")
    const { data, content } = parseFrontmatter(raw)
    return {
      content: content.trim() || BUILTIN_PROMPT,
      name: data.name,
      description: data.description,
    }
  } catch {
    return { content: BUILTIN_PROMPT }
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
  validateSubAgents,
  BUILTIN_CODER,
  BUILTIN_PROMPT,
}
