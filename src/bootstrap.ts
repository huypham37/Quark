// Bootstrap — initialize the agent with profile-declared tools
//
// Built-in tools: read, skill (always available)
// Profile tools: loaded from ~/.config/atom/tools/{id}.ts
//
// Call this once at startup before using the agent loop.

import { register } from "./tool/registry"
import { readTool } from "./tool/read"
import { compactTool } from "./tool/compact"
import { buildSkillTool } from "./tool/skill"
import { getDB } from "./storage/db"
import { loadProfileTools } from "./tool/loader"
import { registerMethod, setDefaultMethod } from "./session/compact-resolver"
import { anchored } from "./session/methods/anchored"
import { general } from "./session/methods/general"
import { loadConfig } from "./config/config"

let initialized = false

export interface BootstrapOptions {
  /** Tools declared in the active profile's tools[] array */
  profileTools?: string[]
  /** Skills bound to the active profile */
  boundSkills?: string[]
}

export async function bootstrap(opts?: BootstrapOptions): Promise<void> {
  if (initialized) return
  initialized = true

  // Initialize SQLite database (lazy — creates tables on first access)
  getDB()

  // Register built-in tools (always available)
  register(readTool)
  register(compactTool)
  register(buildSkillTool(opts?.boundSkills))

  // Register compaction methods and set default from config
  registerMethod(anchored)
  registerMethod(general)
  setDefaultMethod(loadConfig().compact.method)

  // Load profile-declared tools from ~/.config/atom/tools/
  // Missing or invalid tools are shown as notifications (non-blocking)
  if (opts?.profileTools && opts.profileTools.length > 0) {
    await loadProfileTools(opts.profileTools)
  }
}

/**
 * Reset for testing
 */
export function resetBootstrap(): void {
  initialized = false
}
