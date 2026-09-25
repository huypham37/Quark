// Explicit run policies — the runner's config-free execution contract.
//
// The engine never reads a config file. Callers (the Quark app, tests) pass
// concrete policies; an AgentDefinition run with none supplied gets
// PORTABLE_POLICIES: bounded steps, no auto-branching, no auto-title, no undo.

export interface BranchingConfig {
  threshold: number
  auto: boolean
}

export interface RunPolicies {
  /** Max agent-loop iterations before stopping. */
  maxSteps: number
  /** Auto-branching policy; `auto: false` never branches (and skips the threshold check). */
  branching: BranchingConfig
  /** Small model spec used for automatic session titles; `null` disables auto-titling. */
  smallModel: string | null
  /**
   * Whether to track turns for `/undo` (file snapshots under the session
   * storage root). `false` keeps portable runs off the filesystem entirely.
   */
  undo: boolean
}

/** Safe defaults for a portable AgentDefinition run: no config file is consulted. */
export const PORTABLE_POLICIES: RunPolicies = {
  maxSteps: 100,
  branching: { auto: false, threshold: 0.9 },
  smallModel: null,
  undo: false,
}

/** Fill portable defaults into caller-supplied policies. */
export function resolveRunPolicies(provided?: Partial<RunPolicies>): RunPolicies {
  return { ...PORTABLE_POLICIES, ...provided }
}
