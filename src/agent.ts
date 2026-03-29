// Agent configuration type and defaults
//
// AgentConfig is the runtime representation of an active agent.
// It can be constructed from a ProfileDef (profile-driven) or directly.

import type { ProfileDef } from "./profile/profile";

/**
 * Runtime configuration for an active agent instance.
 * Constructed from a {@link ProfileDef} via {@link agentFromProfile}, or built directly for programmatic use.
 */
export interface AgentConfig {
  /** Unique agent/profile identifier (e.g. `"coder"`, `"researcher"`) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Resolved system prompt text (read from `promptFile` or inline) */
  prompt: string;
  /** Tool IDs available to this agent */
  tools: string[];
  /** Skill names bound to this agent (L1 metadata loaded into system prompt) */
  skills: string[];
  /** Profile IDs of sub-agents this agent can spawn */
  subAgents?: string[];
  /** Model string to use for this agent (e.g. `"copilot/gpt-4o"`). Falls back to config `main_model` if omitted. */
  model?: string;
}

/**
 * The built-in fallback agent config used when no profile is specified.
 * Equivalent to the `coder` profile with `read`, `write`, `edit`, `bash`, `skill` tools.
 */
export const defaultAgent: AgentConfig = {
  id: "coder",
  name: "Coder",
  prompt:
    "You are a coding assistant. Help the user with software engineering tasks.",
  tools: ["read", "write", "edit", "bash", "skill"],
  skills: [],
};

/**
 * Build an {@link AgentConfig} from a resolved {@link ProfileDef} and its prompt file content.
 *
 * @param profile - The resolved profile definition
 * @param promptContent - The system prompt text (read from `profile.promptFile`)
 * @returns A fully populated `AgentConfig` ready for use with {@link prompt}
 */
export function agentFromProfile(
  profile: ProfileDef,
  promptContent: string,
): AgentConfig {
  return {
    id: profile.id,
    name: profile.name,
    prompt: promptContent,
    tools: profile.tools,
    skills: profile.skills,
    subAgents: profile.subAgents,
    model: profile.model,
  };
}
