import { defineConfig } from "tsup"

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  external: [
    // Bun-specific module (interactive TUI is spawned with Bun)
    "bun",
    // UI deps (the TUI is loaded from source at runtime, not bundled here)
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
    // The engine is a real dependency, resolved from node_modules at runtime.
    // Bundling it here would ship a second copy alongside the one Bun loads
    // for the TUI, splitting singleton state (event bus, config cache, ...).
    /^@quark\/runner(\/|$)/,
  ],
  treeshake: true,
  splitting: false,
  sourcemap: true,
  skipNodeModulesBundle: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
})
