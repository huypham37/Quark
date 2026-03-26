import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["index.ts"],
  format: ["cjs", "esm"],
  dts: false, // We'll generate types separately with tsc
  clean: true,
  external: [
    // Bun-specific modules (users must run in Bun environment)
    "bun:sqlite",
    "bun",
    
    // UI dependencies (not needed for SDK usage)
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
  noExternal: [],
  treeshake: true,
  splitting: false,
  sourcemap: true,
  skipNodeModulesBundle: true,
})
