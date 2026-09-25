// Hook registry — stores hook handlers collected from plugins.
//
// Two shapes:
//   - `createHookRegistry(handlers?)` — an isolated registry for one runner.
//   - `globalHooks` — the process-global singleton used by the legacy
//     prompt()/AgentConfig path and the filesystem plugin loader.
//
// Legacy helpers `registerHook`/`fireHook`/`clearHooks` delegate to
// `globalHooks`, so CLI/TUI behavior is unchanged.

import type { HookName, HookInput, HookOutput, HookFn, HookHandlers } from "./plugin"

/**
 * An isolated collection of hook handlers. Each runner owns one; firing a hook
 * only runs handlers registered on that instance.
 */
export interface HookRegistry {
  /** Add a handler for a hook name (registration order is preserved). */
  register<K extends HookName>(name: K, fn: HookFn<K>): void
  /** Run every handler for a hook and return the final mutable output. */
  fire<K extends HookName>(
    name: K,
    input: HookInput<K>,
    seed?: Record<string, unknown>,
  ): Promise<HookOutput<K>>
  /** Drop all handlers (useful for tests and long-lived reconfiguration). */
  clear(): void
}

// ---------------------------------------------------------------------------
// Default output values per hook (used as the starting mutable output object)
// ---------------------------------------------------------------------------
function defaultOutput(name: HookName): Record<string, unknown> {
  switch (name) {
    case "provider.request.before":
      // Will be seeded with actual provider/model before firing
      return { provider: "", model: "" }
    case "provider.request.error":
      return { retry: false }
    case "tool.execute.before":
      // Will be seeded with actual args before firing
      return { args: {} }
    default:
      return {}
  }
}

/**
 * Create an isolated hook registry, optionally pre-populated with handlers.
 *
 * @example
 * ```ts
 * const hooks = createHookRegistry({
 *   "loop.step.before": async ({ step }) => console.log("step", step),
 * })
 * ```
 */
export function createHookRegistry(handlers?: HookHandlers): HookRegistry {
  const registry = new Map<HookName, HookFn<any>[]>()

  const api: HookRegistry = {
    register<K extends HookName>(name: K, fn: HookFn<K>): void {
      const list = registry.get(name) ?? []
      list.push(fn as HookFn<any>)
      registry.set(name, list)
    },
    async fire<K extends HookName>(
      name: K,
      input: HookInput<K>,
      seed?: Record<string, unknown>,
    ): Promise<HookOutput<K>> {
      const list = registry.get(name)
      const output: Record<string, unknown> = { ...defaultOutput(name), ...(seed ?? {}) }
      for (const fn of list ?? []) {
        await fn(input, output)
      }
      return output as HookOutput<K>
    },
    clear(): void {
      registry.clear()
    },
  }

  if (handlers) {
    for (const [name, fn] of Object.entries(handlers)) {
      if (typeof fn === "function") api.register(name as HookName, fn as any)
    }
  }

  return api
}

/**
 * Process-global registry. Populated by the filesystem plugin loader
 * (`~/.config/quark/plugins/*.ts`) during bootstrap and used by the legacy
 * `prompt()` path. Portable runners must never route through it.
 */
export const globalHooks: HookRegistry = createHookRegistry()

// ---------------------------------------------------------------------------
// Legacy global helpers — thin delegates so existing call sites are unchanged
// ---------------------------------------------------------------------------

/** Register a handler on the process-global registry. */
export function registerHook<K extends HookName>(name: K, fn: HookFn<K>): void {
  globalHooks.register(name, fn)
}

/** Fire a hook on the process-global registry. */
export function fireHook<K extends HookName>(
  name: K,
  input: HookInput<K>,
  seed?: Record<string, unknown>,
): Promise<HookOutput<K>> {
  return globalHooks.fire(name, input, seed)
}

/** Reset the process-global registry (for tests). */
export function clearHooks(): void {
  globalHooks.clear()
}
