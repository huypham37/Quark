// Compatibility resolver — resolved legacy profile → portable AgentDefinition.
//
// Profile YAML stays a temporary app-side source. This module takes the
// already-resolved ProfileDef plus its prompt text and materializes concrete
// ToolDefs and SkillDefinitions, so the CLI/TUI prompt path can hand an
// AgentDefinition to the runner without any global tool registry or runtime
// profile lookup.
//
// Lives in packages/quark (not packages/runner) on purpose: this is the
// app-side bridge for legacy profiles, not engine semantics.

import { buildSkillTool } from "@quark/runner/tool/skill"
import { createSubagentTool } from "@quark/runner/tool/subagent"
import { loadProfileTools } from "./tool-loader"
import { lookTool } from "@quark/runner/tool/look"
import { readTool } from "@quark/runner/tool/read"
import { profileSkills, type SkillDefinition } from "@quark/runner/skill/skill"
import type { AgentDefinition } from "@quark/runner/agent"
import type { ProfileDef } from "./profile/profile"
import type { ToolDef } from "@quark/runner/tool/tool"

/**
 * Injectable dependencies for {@link materializeAgent}.
 *
 * `resolveSkills` exists because skill discovery is a process-global cache;
 * tests use it to stay hermetic instead of mutating cwd/HOME.
 */
export interface MaterializeDeps {
  /** Resolve bound skill names to concrete definitions. Defaults to global discovery. */
  resolveSkills?: (names: string[]) => SkillDefinition[]
}

/**
 * Materialize a portable {@link AgentDefinition} from a resolved legacy profile.
 *
 * - `profile.tools` IDs are resolved to concrete {@link ToolDef}s: built-ins
 *   (`read`, `look`, `skill`) come from the engine; the rest are imported from
 *   `~/.config/quark/tools/{id}.ts` **without** registering them globally.
 *   Missing/invalid tools are skipped, matching the legacy `resolveAvailable`.
 * - `profile.skills` names are resolved to concrete {@link SkillDefinition}s and
 *   attached to both the system prompt and the synthesized `skill` tool.
 *
 * @param profile - Resolved profile (from `resolveProfile`)
 * @param prompt - Prompt text (from `readPromptFile(profile).content`)
 * @param deps - Optional overrides (test seam)
 */
export async function materializeAgent(
  profile: ProfileDef,
  prompt: string,
  deps: MaterializeDeps = {},
): Promise<AgentDefinition> {
  const skills: SkillDefinition[] = (deps.resolveSkills ?? profileSkills)(profile.skills)
  const { defs } = await loadProfileTools(profile.tools, { register: false })
  const loaded = new Map(defs.map((def) => [def.id, def]))

  const tools: ToolDef[] = []
  for (const id of profile.tools) {
    if (id === "read") {
      tools.push(readTool)
    } else if (id === "look") {
      tools.push(lookTool)
    } else if (id === "skill") {
      tools.push(buildSkillTool(undefined, skills))
    } else {
      const def = loaded.get(id)
      if (def) tools.push(def)
    }
  }

  // Sub-agent delegation is an app concern: the profile's `sub_agents` become a
  // concrete tool carrying the allowed IDs, so the engine never reads profile
  // config and the child process re-resolves its own profile.
  if (profile.subAgents && profile.subAgents.length > 0) {
    tools.push(createSubagentTool(profile.subAgents))
  }

  return {
    id: profile.id,
    name: profile.name,
    instructions: prompt,
    tools,
    skills,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinkingEffort ? { thinkingEffort: profile.thinkingEffort } : {}),
    ...(profile.thinkingMode ? { thinkingMode: profile.thinkingMode } : {}),
  }
}
