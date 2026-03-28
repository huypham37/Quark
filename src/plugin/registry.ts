// Plugin registry — stores all hook handlers collected from loaded plugins
//
// Usage:
//   registerHook("session.idle", myFn)
//   const output = await fireHook("provider.request.before", { provider, model, messages })
//   clearHooks()  // for testing

import type { HookName, HookInput, HookOutput, HookFn } from "./plugin"

// Internal storage: hook name → list of handlers (in registration order)
const registry = new Map<HookName, HookFn<any>[]>()

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
    case "session.compacting":
      return { context: [] }
    case "tool.execute.before":
      // Will be seeded with actual args before firing
      return { args: {} }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// registerHook — add a handler for a given hook
// ---------------------------------------------------------------------------
export function registerHook<K extends HookName>(name: K, fn: HookFn<K>): void {
  const list = registry.get(name) ?? []
  list.push(fn as HookFn<any>)
  registry.set(name, list)
}

// ---------------------------------------------------------------------------
// fireHook — run all handlers for a hook, return final output
// ---------------------------------------------------------------------------
export async function fireHook<K extends HookName>(
  name: K,
  input: HookInput<K>,
  seed?: Record<string, unknown>,
): Promise<HookOutput<K>> {
  const handlers = registry.get(name)
  const output: Record<string, unknown> = { ...defaultOutput(name), ...(seed ?? {}) }

  if (handlers && handlers.length > 0) {
    for (const fn of handlers) {
      await fn(input, output)
    }
  }

  return output as HookOutput<K>
}

// ---------------------------------------------------------------------------
// clearHooks — reset all registrations (for tests)
// ---------------------------------------------------------------------------
export function clearHooks(): void {
  registry.clear()
}
