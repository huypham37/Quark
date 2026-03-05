// Agent configuration type and defaults

export interface AgentConfig {
  id: string
  name: string
  prompt: string
  tools: string[]
  maxSteps: number
  /** Token threshold for automatic compaction (default: 100_000) */
  contextLimitTokens: number
}

export const defaultAgent: AgentConfig = {
  id: "coder",
  name: "Coder",
  prompt:
    "You are a coding assistant. Help the user with software engineering tasks.",
  tools: ["read", "write", "edit", "bash", "skill", "todo"],
  maxSteps: 100,
  contextLimitTokens: 100_000,
}
