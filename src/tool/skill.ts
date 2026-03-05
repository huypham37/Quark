// Tool: skill — load SKILL.md instruction sets into conversation context

import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"
import { discoverSkills, loadSkill } from "../skill/skill"

export const skillTool = defineTool({
  id: "skill",
  description: buildDescription(),
  parameters: z.object({
    name: z.string().describe("Name of the skill to load"),
  }),
  async execute(args, _ctx) {
    const skill = loadSkill(args.name)

    if (!skill) {
      const available = discoverSkills()
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

function buildDescription(): string {
  const skills = discoverSkills()

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
