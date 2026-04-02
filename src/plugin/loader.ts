// Plugin loader — scan ~/.config/quark/plugins/*.ts, import, collect hooks
//
// Same pattern as src/tool/loader.ts:
//   1. Scan the plugins directory for *.ts files
//   2. For each file: dynamic import → grab default or named "plugin" export
//   3. Call the PluginFn with PluginContext → get hook map back
//   4. Register each hook in the registry
//   5. Report loaded/errors

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { fileURLToPath, pathToFileURL } from "url"
import { registerHook } from "./registry"
import { registerProvider } from "../config/config"
import { error as notifyError } from "../notification/notification"
import type { PluginFn, HookName } from "./plugin"

const PLUGINS_DIR = path.join(os.homedir(), ".config", "quark", "plugins")

export interface PluginLoadResult {
  loaded: string[]
  errors: Array<{ file: string; error: string }>
}

/**
 * Scan ~/.config/quark/plugins/*.ts, import each file, call the exported
 * PluginFn with a PluginContext, and register all returned hooks.
 *
 * Errors are surfaced as notifications (non-blocking).
 */
export async function loadPlugins(): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { loaded: [], errors: [] }

  // No plugins directory → silently skip
  if (!fs.existsSync(PLUGINS_DIR)) {
    return result
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    notifyError("Plugin Load Error", `Could not read plugins dir: ${msg}`)
    return result
  }

  const tsFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => e.name)

  // Derive quarkRoot: this file lives at src/plugin/loader.ts, so go up two levels
  // Use import.meta.dir (Bun) with Node.js fallback via import.meta.url
  const thisDir = typeof import.meta.dir === "string"
    ? import.meta.dir
    : path.dirname(fileURLToPath(import.meta.url))
  const quarkRoot = path.resolve(thisDir, "../..")

  const ctx = {
    directory: process.cwd(),
    sessionId: process.env.QUARK_SESSION_ID,
    quarkRoot,
    registerProvider,
  }

  for (const fileName of tsFiles) {
    const filePath = path.join(PLUGINS_DIR, fileName)

    try {
      // Dynamic import — use file:// URL for Windows compatibility.
      // On Windows, bare absolute paths like "C:\..." are rejected by
      // Node's ESM loader which interprets "C:" as a URL protocol.
      const importURL = pathToFileURL(filePath).href
      const mod = await import(importURL)

      // Support default export or named "plugin" export
      const pluginFn: PluginFn | undefined = mod.default ?? mod.plugin

      if (typeof pluginFn !== "function") {
        const msg = "No plugin export found (expected 'default' or 'plugin')"
        result.errors.push({ file: fileName, error: msg })
        notifyError("Plugin Load Failed", `${fileName}: ${msg}`)
        continue
      }

      // Call the plugin function to get its hook map
      const hooks = await pluginFn(ctx)

      // Register each returned hook
      let hookCount = 0
      for (const [hookName, fn] of Object.entries(hooks)) {
        if (typeof fn === "function") {
          registerHook(hookName as HookName, fn as any)
          hookCount++
        }
      }

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
 * Get the plugins directory path
 */
export function getPluginsDir(): string {
  return PLUGINS_DIR
}
