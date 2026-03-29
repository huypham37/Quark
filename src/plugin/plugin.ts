// Plugin type definitions
//
// A plugin is an async function dropped in ~/.config/quark/plugins/*.ts.
// It receives a PluginContext and returns a partial map of hook handlers.
// Each hook handler receives (input, output) and may mutate output in-place.

// ---------------------------------------------------------------------------
// Context passed to every plugin function at load time
// ---------------------------------------------------------------------------
export interface PluginContext {
  /** Current working directory */
  directory: string
  /** Active session ID (if any) */
  sessionId?: string
  /** Absolute path to the Quark installation root (useful for finding scripts/) */
  quarkRoot: string
  /**
   * Register an OpenAI-compatible provider at runtime.
   * Equivalent to adding it under `providers:` in config.yaml, but in-memory only.
   * Takes precedence over config.yaml entries for the same ID.
   */
  registerProvider: (id: string, config: { baseURL: string; apiKey: string }) => void
}

// ---------------------------------------------------------------------------
// All hooks — input/output shapes per hook name
// ---------------------------------------------------------------------------
export interface PluginHooks {
  // --- Provider hooks ---
  "provider.request.before": {
    input:  { provider: string; model: string; messages: any[] }
    output: { provider: string; model: string }
  }
  "provider.request.error": {
    input:  { provider: string; model: string; error: unknown; statusCode?: number }
    output: { retry: boolean; provider?: string; model?: string }
  }

  // --- Session hooks ---
  "session.created":    { input: { sessionId: string };                                   output?: never }
  "session.idle":       { input: { sessionId: string };                                   output?: never }
  "session.error":      { input: { sessionId: string; error: unknown };                   output?: never }
  "session.compacting": { input: { sessionId: string }; output: { context: string[] } }

  // --- Tool hooks ---
  "tool.execute.before": {
    input:  { tool: string; args: Record<string, unknown> }
    output: { args: Record<string, unknown> }
  }
  "tool.execute.after": {
    input:  { tool: string; args: Record<string, unknown>; result: string }
    output: Record<string, never>
  }

  // --- Loop hooks ---
  "loop.step.before": { input: { sessionId: string; step: number }; output?: never }
  "loop.step.after":  { input: { sessionId: string; step: number; result: "continue" | "stop" }; output?: never }
}

// ---------------------------------------------------------------------------
// Derived helper types
// ---------------------------------------------------------------------------

export type HookName = keyof PluginHooks

/** Input type for a given hook */
export type HookInput<K extends HookName> = PluginHooks[K]["input"]

/** Output type for a given hook (falls back to empty object when undefined) */
export type HookOutput<K extends HookName> =
  PluginHooks[K] extends { output: infer O } ? (O extends undefined ? Record<string, never> : O) : Record<string, never>

/** A single hook handler function */
export type HookFn<K extends HookName> = (
  input:  HookInput<K>,
  output: HookOutput<K>,
) => Promise<void>

// ---------------------------------------------------------------------------
// PluginFn — what a plugin file must export (default or named "plugin")
// ---------------------------------------------------------------------------
export type PluginFn = (ctx: PluginContext) => Promise<
  Partial<{
    [K in HookName]: HookFn<K>
  }>
>
