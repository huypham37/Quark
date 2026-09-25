// App-side ambient instruction reads.
//
// The engine takes ambient text explicitly; the Quark app opts into the legacy
// `<config-dir>/AGENTS.md` + project `./AGENTS.md` reads by passing this
// function as a runner's `ambientInstructions` builder.

import * as fs from "node:fs"
import * as path from "node:path"
import { configDir } from "./config/config"

/**
 * Read the global `<config-dir>/AGENTS.md` plus the workspace `AGENTS.md`.
 *
 * The workspace is passed by the engine (a remote runner serves many sessions
 * from one process, so `process.cwd()` is the server's, not the session's);
 * callers that omit it keep the process-cwd behavior.
 */
export function loadAmbientInstructions(workspace?: string): string[] {
  return [loadGlobalAgentInstructions(), loadProjectAgentInstructions(workspace)].filter(
    (block): block is string => block !== null,
  )
}

function loadGlobalAgentInstructions(): string | null {
  const globalPath = path.join(configDir(), "AGENTS.md")
  try {
    const content = fs.readFileSync(globalPath, "utf-8").trim()
    if (!content) return null
    return `# Global Agent Instructions\n\n${content}`
  } catch {
    return null
  }
}

function loadProjectAgentInstructions(workspace?: string): string | null {
  const projectPath = path.resolve(workspace ?? process.cwd(), "AGENTS.md")
  try {
    const content = fs.readFileSync(projectPath, "utf-8").trim()
    if (!content) return null
    return `# Project Agent Instructions\n\n${content}`
  } catch {
    return null
  }
}
