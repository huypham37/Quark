import { defineConfig } from "tsup"

// Single entry: the ACP server surface (schema, transport, bridge, agent).
// `@quark/runner` is a real dependency resolved from node_modules at runtime —
// bundling it would ship a second copy of the engine's singleton state (event
// bus, config cache) alongside the one the host process already loaded.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false, // Declarations are generated separately with tsc
    clean: true,
    external: ["bun", /^@quark\/runner(\/|$)/],
    treeshake: true,
    splitting: false,
    sourcemap: true,
    skipNodeModulesBundle: true,
  },
  {
    // CommonJS entry for `require("@quark/acp")`.
    entry: ["src/index.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    external: ["bun", /^@quark\/runner(\/|$)/],
    treeshake: true,
    splitting: false,
    sourcemap: true,
    skipNodeModulesBundle: true,
  },
])
