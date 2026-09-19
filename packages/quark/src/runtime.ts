// App-side agent runtime — one stable bus, one swappable runner instance.
//
// The CLI/TUI used to call the module-singleton prompt()/cancel()/isActive()
// and subscribe to the singleton `bus`. This manager owns a createRunner()
// instance bound to the materialized AgentDefinition instead, and recreates it
// on profile/worktree/config switches.
//
// Legacy app behavior is adapted explicitly into createRunner options:
//   - ambient AGENTS.md reads (portable runners default to none)
//   - config-derived max steps / branching / small model (portable policies
//     would otherwise never read config.yaml)
//   - custom provider config (portable runners otherwise resolve against {})
//   - filesystem plugins (registered into the runner's isolated hooks, not the
//     process-global registry)
//   - persistent JSONL sessions (the library default for AgentDefinitions is an
//     in-memory store)
//
// One bus is shared across runner generations, so long-lived UI subscriptions
// (wireEvents, ghostty title, App) survive a rebind and can never leak per
// runner. That is the app's deliberate choice; the library's createRunner still
// defaults to a fresh, isolated bus.

import {
  createRunner,
  defaultSessionStore,
  type AgentDefinition,
  type PluginFn,
  type Runner,
  type RunnerOptions,
  type RunnerPromptInput,
  type RunnerSeedInput,
  type RunPolicies,
  type SessionStore,
  type TypedBus,
} from "@quark/runner"
import { loadConfig } from "./config/config"
import { loadAmbientInstructions } from "./ambient"
import { createPluginContext, loadPluginFns } from "./plugin-loader"

export interface QuarkRuntimeOptions {
  agent: AgentDefinition
  /** Stable bus shared by every runner generation. */
  bus: TypedBus
  /** Session store. Defaults to the persistent JSONL store (`defaultSessionStore`). */
  store?: SessionStore
  /** Test seam: override plugin discovery. Defaults to the filesystem loader. */
  loadPlugins?: () => Promise<{ fns: PluginFn[] }>
  /** Test seam: extra runner options (`stream`, `execute`, ...). Cannot replace agent/bus/store/plugins. */
  runnerOptions?: Partial<RunnerOptions>
}

export interface QuarkRuntime {
  readonly bus: TypedBus
  readonly agent: AgentDefinition
  /** The current runner generation. Replaced on {@link rebind}. */
  readonly runner: Runner
  prompt(input: RunnerPromptInput): Promise<{ sessionId: string }>
  /** Run a `/steer`-style turn whose user message is already persisted. */
  seed(input: RunnerSeedInput): Promise<{ sessionId: string }>
  cancel(sessionId: string): void
  isActive(sessionId: string): boolean
  /** Whether any run is in flight in the current runner generation. */
  isBusy(): boolean
  /**
   * Recreate the runner bound to a new agent, reloading filesystem plugins for
   * the current working directory (worktree switches change it). The bus is
   * unchanged, so no event subscription is re-registered or leaked.
   *
   * Refuses (throws) while a run is active: dropping the current runner would
   * orphan that run's abort controller, leaving it uncancellable.
   */
  rebind(agent: AgentDefinition): Promise<void>
  /**
   * Synchronous rebind reusing the plugins from the last load. Used for
   * per-agent toggles (e.g. thinking effort) that do not change cwd/config.
   * Refuses (throws) while a run is active, for the same reason as {@link rebind}.
   */
  retarget(agent: AgentDefinition): void
}

/** Config-derived execution policies, preserving the legacy implicit config read. */
function configPolicies(): Partial<RunPolicies> {
  const config = loadConfig()
  return {
    maxSteps: config.maxSteps,
    branching: config.branching,
    smallModel: config.models.small,
    // Legacy CLI/TUI tracks turns for /undo. Portable policies default this off.
    undo: true,
  }
}

export async function createQuarkRuntime(options: QuarkRuntimeOptions): Promise<QuarkRuntime> {
  const { bus } = options
  const store = options.store ?? defaultSessionStore
  const resolvePlugins = options.loadPlugins ?? (async () => ({ fns: (await loadPluginFns()).fns }))

  let agent = options.agent
  let runner: Runner
  let pluginFns: PluginFn[] = []

  function build(next: AgentDefinition, plugins: PluginFn[]): Runner {
    return createRunner({
      ...options.runnerOptions,
      agent: next,
      eventBus: bus,
      store,
      ambientInstructions: loadAmbientInstructions,
      policies: configPolicies(),
      // Custom providers otherwise resolve against {} on the portable path.
      resolve: { providers: loadConfig().providers },
      plugins,
      pluginContext: createPluginContext(),
    })
  }

  // The small model for auto-titles follows the legacy `model ?? config.small`
  // (a `--model`/`/model` override wins for the turn's title call). Per-call
  // policies merge over the runner's config-derived ones.
  function turnPolicies(model?: string): Partial<RunPolicies> {
    return { smallModel: model ?? loadConfig().models.small }
  }

  function apply(next: AgentDefinition, plugins: PluginFn[]): void {
    agent = next
    pluginFns = plugins
    runner = build(next, plugins)
  }

  apply(agent, (await resolvePlugins()).fns)

  return {
    bus,
    get agent() {
      return agent
    },
    get runner() {
      return runner
    },
    prompt(input) {
      return runner.prompt({ ...input, policies: { ...turnPolicies(input.model), ...input.policies } })
    },
    seed(input) {
      return runner.seed({ ...input, policies: { ...turnPolicies(input.model), ...input.policies } })
    },
    cancel(sessionId) {
      runner.cancel(sessionId)
    },
    isActive(sessionId) {
      return runner.isActive(sessionId)
    },
    isBusy() {
      return runner.hasActiveRun()
    },
    async rebind(next) {
      assertNotBusy(runner)
      apply(next, (await resolvePlugins()).fns)
    },
    retarget(next) {
      assertNotBusy(runner)
      apply(next, pluginFns)
    },
  }
}

/** Refuse to replace a runner that still owns an in-flight run. */
function assertNotBusy(runner: Runner): void {
  if (runner.hasActiveRun()) {
    throw new Error("Cannot switch agent while a run is active; cancel it first")
  }
}
