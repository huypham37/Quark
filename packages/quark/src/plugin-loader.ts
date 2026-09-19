// Plugin loader — scan <config>/plugins/*.ts, import, collect hooks
//
// App-side filesystem adapter: discovery/import lives here, while the hook
// contracts and registries live in `@quark/runner` (plugin/plugin, plugin/registry).
//
// Same pattern as src/tool-loader.ts:
//   1. Scan the plugins directory for *.ts files
//   2. For each file: dynamic import → grab default or named "plugin" export
//   3. Call the PluginFn with PluginContext → get hook map back
//   4. Register each hook in the registry
//   5. Report loaded/errors
//
// Two consumers:
//   - loadPlugins() registers into the process-global registry (legacy CLI
//     bootstrap / sub-agent path).
//   - loadPluginFns() returns the imported PluginFns (error-tolerant) so an
//     instance runner can register them into its own isolated hook registry.

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { globalHooks, type PluginContext, type PluginFn } from "@quark/runner"
import { configDir } from "./config/config"
import { error as notifyError } from "@quark/runner/notification/notification"
import { isVerbose } from "@quark/runner/debug"

/** Plugins directory, resolved per call so QUARK_CONFIG_DIR stays authoritative. */
function pluginsDir(): string {
  return path.join(configDir(), "plugins")
}

export interface PluginLoadResult {
  loaded: string[]
  errors: Array<{ file: string; error: string }>
}

function withSuppressedConsole<T>(fn: () => T): T {
  if (isVerbose()) return fn()

  const noop = () => {}
  const log = console.log
  const warn = console.warn
  const error = console.error

  console.log = noop
  console.warn = noop
  console.error = noop

  try {
    return fn()
  } finally {
    console.log = log
    console.warn = warn
    console.error = error
  }
}

/**
 * Context passed to every plugin function: current directory, active session
 * (if any), and the Quark installation root for locating bundled scripts.
 */
export function createPluginContext(): PluginContext {
  // Derive quarkRoot: this file lives at src/plugin-loader.ts (or is bundled
  // into dist/cli.js), so the package root is one level up in both cases.
  const thisDir = typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url))
  return {
    directory: process.cwd(),
    sessionId: process.env.QUARK_SESSION_ID,
    quarkRoot: path.resolve(thisDir, ".."),
  }
}

interface ImportedPlugin {
  file: string
  fn: PluginFn
}

/** Scan + import plugin modules. Invocation/registration is the caller's job. */
async function importPlugins(): Promise<{
  plugins: ImportedPlugin[]
  loaded: string[]
  errors: Array<{ file: string; error: string }>
}> {
  const dir = pluginsDir()
  const result: { plugins: ImportedPlugin[]; loaded: string[]; errors: Array<{ file: string; error: string }> } = {
    plugins: [],
    loaded: [],
    errors: [],
  }

  if (!fs.existsSync(dir)) return result

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    notifyError("Plugin Load Error", `Could not read plugins dir: ${msg}`)
    return result
  }

  const tsFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => e.name)

  for (const fileName of tsFiles) {
    const filePath = path.join(dir, fileName)
    try {
      // Dynamic import — use file:// URL for Windows compatibility.
      const importURL = pathToFileURL(filePath).href
      const mod = await withSuppressedConsole(() => import(importURL))
      const pluginFn: PluginFn | undefined = mod.default ?? mod.plugin

      if (typeof pluginFn !== "function") {
        const msg = "No plugin export found (expected 'default' or 'plugin')"
        result.errors.push({ file: fileName, error: msg })
        notifyError("Plugin Load Failed", `${fileName}: ${msg}`)
        continue
      }

      result.plugins.push({ file: fileName, fn: pluginFn })
      result.loaded.push(fileName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ file: fileName, error: msg })
      notifyError("Plugin Load Error", `${fileName}: ${msg}`, 5000)
    }
  }

  return result
}

/**
 * Import the filesystem plugins and return their PluginFns, wrapped so an
 * invocation failure is reported and skipped (matching the legacy loader)
 * rather than rejecting the prompt that triggered the hook registration.
 *
 * The runner calls the returned functions with its own {@link PluginContext},
 * registering the hooks into that runner's isolated registry.
 */
export async function loadPluginFns(): Promise<{
  fns: PluginFn[]
  loaded: string[]
  errors: PluginLoadResult["errors"]
}> {
  const { plugins, loaded, errors } = await importPlugins()
  const fns = plugins.map(({ file, fn }): PluginFn => async (ctx) => {
    try {
      return await withSuppressedConsole(() => fn(ctx))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      notifyError("Plugin Load Error", `${file}: ${msg}`, 5000)
      return {}
    }
  })
  return { fns, loaded, errors }
}

/**
 * Scan <config>/plugins/*.ts, import each file, call the exported PluginFn with
 * a PluginContext, and register all returned hooks globally.
 *
 * Errors are surfaced as notifications (non-blocking).
 */
export async function loadPlugins(): Promise<PluginLoadResult> {
  const { plugins, loaded, errors } = await importPlugins()
  const result: PluginLoadResult = { loaded, errors }
  const ctx = createPluginContext()

  for (const { file, fn } of plugins) {
    try {
      const hooks = await withSuppressedConsole(() => fn(ctx))
      for (const [hookName, hookFn] of Object.entries(hooks)) {
        if (typeof hookFn === "function") {
          globalHooks.register(hookName as any, hookFn as any)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ file, error: msg })
      notifyError("Plugin Load Error", `${file}: ${msg}`, 5000)
    }
  }

  return result
}

/**
 * Get the plugins directory path
 */
export function getPluginsDir(): string {
  return pluginsDir()
}
