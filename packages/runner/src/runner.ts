// Instance-based runner API.
//
// createRunner() owns an isolated event bus, cancellation map, and hook
// registry, so multiple runners — each bound to a different AgentDefinition —
// can execute concurrently without sharing listeners, abort state, or hooks. A
// runner never fires the process-global plugin registry, even when a hook name
// collides with one loaded from the filesystem.
//
// The engine is config-free: callers pass explicit policies, providers, and
// ambient instructions. The legacy module-level prompt()/cancel()/isActive()/bus
// stay as wrappers around the singleton runtime for hosts that need the
// process-global session/force-agent state (e.g. the sub-agent child process).

import { prompt as legacyPrompt, runSeededSession, createPromptRuntime, type PromptRuntime } from "./session/prompt"
import { PORTABLE_POLICIES, type RunPolicies } from "./session/policies"
import { MemorySessionStore, type SessionStore } from "./session/store"
import type { StreamFn } from "./session/processor"
import type { TypedBus } from "./session/events"
import type { AgentDefinition } from "./agent"
import type { AmbientInstructions } from "./session/system"
import type { CatalogRegistry } from "./provider/catalog-registry"
import type { ResolveModelOptions } from "./provider/resolver"
import { createHookRegistry, type HookRegistry } from "./plugin/registry"
import type { HookHandlers, HookName, PluginContext, PluginFn } from "./plugin/plugin"

/**
 * Input accepted by {@link Runner.prompt}. Mirrors the legacy `prompt()` input
 * except the agent, which is bound at {@link createRunner} time.
 */
export interface RunnerPromptInput {
  sessionId?: string
  parentSessionId?: string
  ephemeral?: boolean
  parts: { type: "text"; text: string }[]
  images?: { mime: string; data: string }[]
  modelOnlyText?: string
  model?: string
  catalog?: CatalogRegistry
  /** Per-call execution policy overrides. */
  policies?: Partial<RunPolicies>
  /** Model-resolution dependencies for this call (wins over runner options). */
  resolve?: ResolveModelOptions
}

/** Context handed to a runner's execution function. */
export interface RunnerExecuteContext {
  /** Agent bound to this runner. Always the runner's own; not per-call overridable. */
  agent: AgentDefinition
  /** The runner's isolated event bus. */
  bus: TypedBus
  /** The runner's isolated hook registry. */
  hooks: HookRegistry
  /** Aborted when {@link Runner.cancel} is called for this run's session. */
  signal: AbortSignal
  /** The controller behind {@link signal}. */
  controller: AbortController
}

/**
 * Input accepted by {@link Runner.seed}. Mirrors {@link RunnerPromptInput} but
 * runs a turn whose user message is already persisted (see `/steer`), so it
 * carries the message IDs instead of parts.
 */
export interface RunnerSeedInput {
  sessionId: string
  userMessageId: string
  userText: string
  model?: string
  catalog?: CatalogRegistry
  /** Per-call execution policy overrides. */
  policies?: Partial<RunPolicies>
  /** Model-resolution dependencies for this call (wins over runner options). */
  resolve?: ResolveModelOptions
}

/**
 * Injectable execution function for {@link Runner.seed}. Defaults to the legacy
 * `runSeededSession` implementation; tests can supply a fake.
 */
export type RunnerSeedExecute = (
  input: RunnerSeedInput,
  ctx: RunnerExecuteContext,
) => Promise<{ sessionId: string }>

/**
 * Injectable execution function. Defaults to the legacy `prompt()`
 * implementation; tests can supply a fake to avoid network calls.
 */
export type RunnerExecute = (
  input: RunnerPromptInput,
  ctx: RunnerExecuteContext,
) => Promise<{ sessionId: string }>

/** Options for {@link createRunner}. */
export interface RunnerOptions {
  /** Agent this runner executes. */
  agent: AgentDefinition
  /** Override execution. Defaults to the legacy `prompt()` implementation. */
  execute?: RunnerExecute
  /** Override seeded execution (`/steer` turns). Defaults to the legacy `runSeededSession`. */
  seedExecute?: RunnerSeedExecute
  /**
   * Event bus this runner emits on. Defaults to a fresh isolated bus; a host
   * with long-lived subscribers (CLI/TUI) can pass one stable bus so recreating
   * a runner never orphans listeners.
   */
  eventBus?: TypedBus
  /**
   * @internal Streaming primitive override for the default executor — a test
   * seam so a runner can be exercised without a network provider.
   */
  stream?: StreamFn
  /** Execution policies. Defaults to {@link PORTABLE_POLICIES} merged with these. */
  policies?: Partial<RunPolicies>
  /**
   * Model-resolution dependencies (provider registry, catalog, custom
   * providers, credential store). Defaults to no configured providers.
   */
  resolve?: ResolveModelOptions
  /**
   * Explicit ambient/project instructions for the system prompt. Defaults to
   * none (no `AGENTS.md` reads); pass text, a list of blocks, or a builder.
   */
  ambientInstructions?: AmbientInstructions
  /**
   * Explicit hook handlers owned by this runner. Instance-scoped: they never
   * touch the process-global plugin registry, and same-named hooks on two
   * runners stay isolated.
   */
  hooks?: HookHandlers
  /**
   * Plugin functions resolved once for this runner with {@link pluginContext}.
   * Their returned handlers register into this runner's own hook registry.
   */
  plugins?: PluginFn[]
  /**
   * Context passed to each {@link plugins} function. Defaults to the current
   * directory.
   */
  pluginContext?: PluginContext
  /**
   * Session/history persistence for this runner. Defaults to an in-memory
   * {@link MemorySessionStore} so nothing is written under
   * `~/.config/quark/session`. Instance-scoped: two runners with the same
   * session ID never share history. Pass a store to share persistence between
   * runners (e.g. a host-owned backing store).
   */
  store?: SessionStore
}

/** A runner instance bound to one agent and one isolated event/cancel/hook state. */
export interface Runner {
  readonly agent: AgentDefinition
  /** Instance-owned typed event bus. Never the singleton `bus`. */
  readonly bus: TypedBus
  /** Instance-owned hook registry. Never the process-global registry. */
  readonly hooks: HookRegistry
  /** Session/history store owned by this runner. Defaults to in-memory. */
  readonly store: SessionStore
  /** Run the agent loop. Alias: {@link Runner.run}. */
  prompt(input: RunnerPromptInput): Promise<{ sessionId: string }>
  /** Alias for {@link Runner.prompt}. */
  run(input: RunnerPromptInput): Promise<{ sessionId: string }>
  /**
   * Run a turn whose user message is already persisted (e.g. a `/steer`
   * branch prompt). Shares the runner's bus, hooks, store, and cancellation
   * state with {@link Runner.prompt}.
   */
  seed(input: RunnerSeedInput): Promise<{ sessionId: string }>
  /** Abort the active run for `sessionId` (no-op if not running). */
  cancel(sessionId: string): void
  /** Whether a run is active for `sessionId` on this runner. */
  isActive(sessionId: string): boolean
  /**
   * Whether any run is currently in flight on this runner.
   *
   * Hosts that recreate/replace a runner (rebind on profile/worktree/config
   * change) use this to refuse the swap: dropping a runner with an active run
   * would orphan its abort controller and leak the run.
   */
  hasActiveRun(): boolean
}

/**
 * Create an isolated runner for one {@link AgentDefinition}.
 *
 * @example
 * ```ts
 * const coder = createRunner({ agent: coderAgent })
 * const reviewer = createRunner({ agent: reviewerAgent })
 *
 * coder.bus.on('text-delta', ({ delta }) => process.stdout.write(delta))
 * await coder.prompt({ parts: [{ type: 'text', text: 'Fix the build' }] })
 * ```
 */
export function createRunner(options: RunnerOptions): Runner {
  const agent = options.agent
  const hooks = createHookRegistry(options.hooks)
  // In-memory by default so the engine never touches the global session
  // directory unless a host passes an explicit store.
  const store = options.store ?? new MemorySessionStore()
  const runtime: PromptRuntime = createPromptRuntime(options.eventBus, hooks, store)

  // Plugin functions are async; resolve them once, on first prompt, into this
  // runner's own registry. Nothing here touches the global registry. Returns
  // undefined when there is nothing to resolve, so the no-plugin path stays
  // fully synchronous (prompt() calls execute without an intervening await).
  let pluginsReady: Promise<void> | undefined
  function ensureHooks(): Promise<void> | undefined {
    if (!options.plugins?.length) return undefined
    pluginsReady ??= (async () => {
      const ctx = options.pluginContext ?? {
        directory: process.cwd(),
        quarkRoot: process.cwd(),
      }
      for (const plugin of options.plugins!) {
        const handlers = await plugin(ctx)
        for (const [name, fn] of Object.entries(handlers ?? {})) {
          if (typeof fn === "function") hooks.register(name as HookName, fn as any)
        }
      }
    })()
    return pluginsReady
  }

  // Explicit alternatives to implicit config-file reads, shared by prompt() and
  // seed(). Always the runner's bound agent: there is no per-call agent
  // override, so the agent cannot switch mid-run.
  function executionAdapters(input: { policies?: Partial<RunPolicies>; resolve?: ResolveModelOptions }) {
    const ambient = options.ambientInstructions ?? null
    const policies = { ...PORTABLE_POLICIES, ...options.policies, ...input.policies }
    // Merge runner-level and per-call resolution deps (per-call wins per key).
    const providedResolve =
      options.resolve || input.resolve ? { ...options.resolve, ...input.resolve } : undefined
    // Default to no configured providers so resolution never reads a config file.
    const resolve =
      providedResolve?.registry || providedResolve?.providers !== undefined
        ? providedResolve
        : { ...providedResolve, providers: {} }

    return { ambient, policies, resolve }
  }

  const execute: RunnerExecute =
    options.execute ??
    ((input, ctx) => {
      const { ambient, policies, resolve } = executionAdapters(input)
      return legacyPrompt(
        {
          ...input,
          agent: ctx.agent,
          controller: ctx.controller,
          ambientInstructions: ambient,
          policies,
          resolve,
          ...(options.stream ? { stream: options.stream } : {}),
        },
        runtime,
      )
    })

  const seedExecute: RunnerSeedExecute =
    options.seedExecute ??
    ((input, ctx) => {
      const { ambient, policies, resolve } = executionAdapters(input)
      return runSeededSession(
        {
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          userText: input.userText,
          model: input.model,
          agent: ctx.agent,
          controller: ctx.controller,
          ...(input.catalog ? { catalog: input.catalog } : {}),
          ambientInstructions: ambient,
          policies,
          resolve,
          ...(options.stream ? { stream: options.stream } : {}),
        },
        runtime,
      )
    })

  async function prompt(input: RunnerPromptInput): Promise<{ sessionId: string }> {
    const controller = new AbortController()
    // Key the run immediately when the caller already knows the session, so
    // isActive()/cancel() work before the execute function registers it.
    // Must stay synchronous (before the first await) for that guarantee.
    if (input.sessionId) {
      // Reject before replacing the active controller: a second prompt for a
      // session that is already running would otherwise orphan the first run's
      // controller, making it uncancellable.
      if (runtime.active.has(input.sessionId)) {
        throw new Error(`Session already active: ${input.sessionId}`)
      }
      runtime.active.set(input.sessionId, controller)
    }
    try {
      const ready = ensureHooks()
      if (ready) await ready
      return await execute(input, {
        agent,
        bus: runtime.bus,
        hooks,
        signal: controller.signal,
        controller,
      })
    } finally {
      // Drop any entries still pointing at this controller (legacy prompt
      // removes its own; fakes may never register).
      for (const [id, active] of runtime.active) {
        if (active === controller) runtime.active.delete(id)
      }
    }
  }

  async function seed(input: RunnerSeedInput): Promise<{ sessionId: string }> {
    const controller = new AbortController()
    // Key the run immediately; the seed executor always has a session ID.
    if (runtime.active.has(input.sessionId)) {
      throw new Error(`Session already active: ${input.sessionId}`)
    }
    runtime.active.set(input.sessionId, controller)
    try {
      const ready = ensureHooks()
      if (ready) await ready
      return await seedExecute(input, {
        agent,
        bus: runtime.bus,
        hooks,
        signal: controller.signal,
        controller,
      })
    } finally {
      for (const [id, active] of runtime.active) {
        if (active === controller) runtime.active.delete(id)
      }
    }
  }

  return {
    agent,
    bus: runtime.bus,
    hooks,
    store: runtime.store,
    prompt,
    run: prompt,
    seed,
    cancel(sessionId: string) {
      const controller = runtime.active.get(sessionId)
      if (controller) {
        controller.abort()
        runtime.active.delete(sessionId)
      }
    },
    isActive(sessionId: string) {
      return runtime.active.has(sessionId)
    },
    hasActiveRun() {
      return runtime.active.size > 0
    },
  }
}
