import { existsSync } from "node:fs"
import { join } from "node:path"

export interface TuiLaunchOptions {
  agent?: string
  sessionId?: string
  model?: string
}

/** The installed CLI launches precompiled JS; source development uses `bun run dev`. */
export function tuiLaunchArgs(quarkDir: string, options: TuiLaunchOptions): string[] {
  const entry = join(quarkDir, "dist", "tui.js")
  if (!existsSync(entry)) {
    throw new Error("Compiled TUI is missing. Run `bun run build` first, or use `bun run dev` for source development.")
  }
  return [
    // Needed even when launched outside the checkout (without its bunfig.toml).
    "--conditions=browser",
    entry,
    ...(options.agent ? ["--agent", options.agent] : []),
    ...(options.sessionId ? ["--session", options.sessionId] : []),
    ...(options.model ? ["--model", options.model] : []),
  ]
}
