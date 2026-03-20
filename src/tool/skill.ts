// Tool: skill — load SKILL.md instruction sets into conversation context
//
// When a profile has bound skills, only those are listed as available.
// Skills outside the profile are not discoverable by default.

import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"
import { discoverSkills, loadSkill, profileSkills } from "../skill/skill"

/**
 * Build the skill tool. Accepts optional profile-bound skill names
 * to filter which skills are listed as available.
 */
export function buildSkillTool(boundSkills?: string[]) {
  return defineTool({
    id: "skill",
    description: buildDescription(boundSkills),
    parameters: z.object({
      name: z.string().describe("Name of the skill to load"),
    }),
    async execute(args, _ctx) {
      const skill = loadSkill(args.name)

      if (!skill) {
        const available = getAvailableSkills(boundSkills)
          .map((s) => s.name)
          .join(", ")
        throw new Error(
          `Skill "${args.name}" not found. Available skills: ${available || "none"}`,
        )
      }

      const dir = path.dirname(skill.location)

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory: ${dir}`,
          "</skill_content>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          location: skill.location,
        },
      }
    },
  })
}

function getAvailableSkills(boundSkills?: string[]) {
  if (boundSkills && boundSkills.length > 0) {
    return profileSkills(boundSkills)
  }
  return discoverSkills()
}

function buildDescription(boundSkills?: string[]): string {
  const skills = getAvailableSkills(boundSkills)

  if (skills.length === 0) {
    return (
      "Load a specialized skill that provides domain-specific instructions. " +
      "No skills are currently available."
    )
  }

  const list = skills
    .map((s) => `  - ${s.name}: ${s.description}`)
    .join("\n")

  return (
    "Load a specialized skill that provides domain-specific instructions.\n\n" +
    "Available skills:\n" +
    list
  )
}

// Default instance for backwards compatibility (no profile filtering)
export const skillTool = buildSkillTool()
