// Bootstrap — register all tools and initialize the agent
//
// Call this once at startup before using the agent loop.
// Optionally pass profile-bound skill names to filter the skill tool.

import { register } from "./tool/registry"
import { readTool } from "./tool/read"
import { writeTool } from "./tool/write"
import { editTool } from "./tool/edit"
import { bashTool } from "./tool/bash"
import { buildSkillTool } from "./tool/skill"
import { todoTool } from "./tool/todo"
import { getDB } from "./storage/db"

let initialized = false

export function bootstrap(opts?: { boundSkills?: string[] }) {
  if (initialized) return
  initialized = true

  // Initialize SQLite database (lazy — creates tables on first access)
  getDB()

  // Register all tools
  register(readTool)
  register(writeTool)
  register(editTool)
  register(bashTool)
  register(buildSkillTool(opts?.boundSkills))
  register(todoTool)
}
