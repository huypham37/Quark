// Plugin type definitions
//
// A plugin is an async function dropped in ~/.config/quark/plugins/*.ts.
// It receives a PluginContext and returns a partial map of hook handlers.
// Each hook handler receives (input, output) and may mutate output in-place.

// Plugin type definitions
//
// A plugin is an async function dropped in ~/.config/quark/plugins/*.ts.
// It receives a PluginContext and returns a partial map of hook handlers.
// Each hook handler receives (input, output) and may mutate output in-place.

// ---------------------------------------------------------------------------
// Context passed to every plugin function at load time
// ---------------------------------------------------------------------------

/**
 * Context object passed to every plugin function when it is loaded.
 */
export interface PluginContext {
  /** Current working directory */
  directory: string
  /** Active session ID (if any) */
  sessionId?: string
  /** Absolute path to the Quark installation root (useful for locating `scripts/`) */
  quarkRoot: string
  /**
   * Register an OpenAI-compatible provider at runtime.
   *
   * Equivalent to adding an entry under `providers:` in `config.yaml`, but stored
   * in-memory only and takes precedence over config-file entries for the same ID.
   *
   * @param id - Provider ID (used in model strings, e.g. `"myprovider/gpt-4o"`)
   * @param config.baseURL - OpenAI-compatible API base URL
   * @param config.apiKey - API key (plain string)
   */
  registerProvider: (id: string, config: { baseURL: string; apiKey: string }) => void
}

// ---------------------------------------------------------------------------
// All hooks — input/output shapes per hook name
// ---------------------------------------------------------------------------

/**
 * All available plugin hooks and their input/output shapes.
 *
 * Each hook receives an `input` (read-only event data) and an `output` (mutable result).
 * Mutations to `output` propagate to the next handler in the chain.
 *
 * | Hook | When it fires |
 * |------|---------------|
 * | `provider.request.before` | Before the AI SDK model object is created — can swap provider or model |
 * | `provider.request.error` | On a retryable provider error — can trigger retry with a different provider |
 * | `session.created` | After a new session row is inserted |
 * | `session.idle` | After the agent loop exits (loop-end) |
 * | `session.error` | When an unhandled error occurs inside the loop |
 * | `session.compacting` | During compaction — can inject extra context strings into the summary |
 * | `tool.execute.before` | Before a tool's `execute()` is called — can mutate `args` |
 * | `tool.execute.after` | After a tool returns — receives the result string |
 * | `loop.step.before` | At the start of each loop iteration |
 * | `loop.step.after` | At the end of each loop iteration, with the `"continue"` or `"stop"` result |
 */
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
  "loop.step.after":  { input: { sessionId: string; step: number; result: "continue" | "stop" | "compact" }; output?: never }
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
/**
 * The function signature every plugin file must export as `default` or as `plugin`.
 *
 * @example
 * ```ts
 * // ~/.config/quark/plugins/my-plugin.ts
 * import type { PluginFn } from '@quark/sdk'
 *
 * const plugin: PluginFn = async (ctx) => ({
 *   'provider.request.before': async (input, output) => {
 *     // swap to a fallback model if the primary is slow
 *     if (input.model === 'gpt-4o') output.model = 'gpt-4o-mini'
 *   },
 * })
 *
 * export default plugin
 * ```
 */
export type PluginFn = (ctx: PluginContext) => Promise<
  Partial<{
    [K in HookName]: HookFn<K>
  }>
>
