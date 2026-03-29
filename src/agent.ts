// Agent configuration type and defaults
//
// AgentConfig is the runtime representation of an active agent.
// It can be constructed from a ProfileDef (profile-driven) or directly.

import type { ProfileDef } from "./profile/profile";

export interface AgentConfig {
  id: string;
  name: string;
  /** Resolved system prompt text (read from promptFile or inline) */
  prompt: string;
  /** Tool IDs available to this agent */
  tools: string[];
  /** Skill names bound to this agent (L1 metadata loaded into system prompt) */
  skills: string[];
  /** Profile IDs of sub-agents this agent can spawn */
  subAgents?: string[];
  /** Model to use for this agent (optional) */
  model?: string;
}

export const defaultAgent: AgentConfig = {
  id: "coder",
  name: "Coder",
  prompt:
    "You are a coding assistant. Help the user with software engineering tasks.",
  tools: ["read", "write", "edit", "bash", "skill"],
  skills: [],
};

/**
 * Build an AgentConfig from a resolved ProfileDef + prompt content.
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
