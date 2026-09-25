// Tool: skill — load SKILL.md instruction sets into conversation context
//
// When a profile has bound skills, only those are listed as available.
// Skills outside the profile are not discoverable by default.

import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"
import { discoverSkills, loadSkill, profileSkills, type SkillDefinition } from "../skill/skill"

/**
 * Build the skill tool. Accepts optional profile-bound skill names
 * to filter which skills are listed as available.
 *
 * @param boundSkills - Legacy: profile-bound skill names resolved via global discovery
 * @param skillDefs - Concrete skill definitions; when given, skills are loaded from
 *   these values instead of global discovery (portable agent definitions)
 */
export function buildSkillTool(boundSkills?: string[], skillDefs?: SkillDefinition[]) {
  const findSkill = (name: string) =>
    skillDefs ? skillDefs.find((s) => s.name === name) : loadSkill(name)
  const availableSkills = () => skillDefs ?? getAvailableSkills(boundSkills)

  return defineTool({
    id: "skill",
    description: buildDescription(boundSkills),
    parameters: z.object({
      name: z.string().describe("Name of the skill to load"),
    }),
    async execute(args, _ctx) {
      const skill = findSkill(args.name)

      if (!skill) {
        const available = availableSkills()
          .map((s) => s.name)
          .join(", ")
        throw new Error(
          `Skill "${args.name}" not found. Available skills: ${available || "none"}`,
        )
      }

      const lines = [
        `<skill_content name="${skill.name}">`,
        `# Skill: ${skill.name}`,
        "",
        skill.content.trim(),
        "",
      ]
      if (skill.location) lines.push(`Base directory: ${path.dirname(skill.location)}`)
      lines.push("</skill_content>")

      return {
        title: `Loaded skill: ${skill.name}`,
        output: lines.join("\n"),
        metadata: {
          name: skill.name,
          ...(skill.location ? { location: skill.location } : {}),
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

function buildDescription(_boundSkills?: string[]): string {
  return "Load a specialized skill by name. Activated skills are provided in the conversation context."
}

// Default instance for backwards compatibility (no profile filtering)
export const skillTool = buildSkillTool()
