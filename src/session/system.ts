// System prompt builder
//
// Assembles the system prompt from:
// 1. Agent prompt (from profile's prompt_file or inline)
// 2. L1 skill metadata (name + description for profile-bound skills)
// 3. Sub-agent list (profile IDs the agent can spawn)
// 4. Environment info (cwd, OS, date)

import * as os from "os"
import { profileSkills } from "../skill/skill"
import { loadProfileConfig } from "../profile/profile"
import type { AgentConfig } from "../agent"

export function buildSystem(agent: AgentConfig): string[] {
  const parts = [agent.prompt]

  // L1 skill metadata — only for profile-bound skills
  const skillBlock = buildSkillBlock(agent.skills)
  if (skillBlock) parts.push(skillBlock)

  // Sub-agent metadata
  const subAgentBlock = buildSubAgentBlock(agent.subAgents)
  if (subAgentBlock) parts.push(subAgentBlock)

  parts.push(environmentBlock())
  return parts
}

function buildSkillBlock(skillNames: string[]): string | null {
  const skills = profileSkills(skillNames)
  if (skills.length === 0) return null

  const lines = skills.map((s) => `- **${s.name}**: ${s.description}`)
  return [
    "# Available Skills",
    "",
    "Use the `skill` tool to load any of these when needed:",
    ...lines,
  ].join("\n")
}

export function buildSubAgentBlock(subAgentIds?: string[]): string | null {
  if (!subAgentIds || subAgentIds.length === 0) return null

  const config = loadProfileConfig()
  const lines = subAgentIds
    .filter((id) => config.profiles[id])
    .map((id) => {
      const prof = config.profiles[id]!
      return `- **${prof.name}** (\`${id}\`)`
    })

  if (lines.length === 0) return null

  return [
    "# Available Sub-Agents",
    "",
    "You can spawn the following sub-agents using the bash tool with `--sub-agent --profile <id>`:",
    ...lines,
  ].join("\n")
}

function environmentBlock(): string {
  return [
    `Working directory: ${process.cwd()}`,
    `OS: ${os.platform()} (${os.release()}) on ${os.arch()}`,
    `Today's date: ${new Date().toDateString()}`,
  ].join("\n")
}
