import { fileURLToPath } from "node:url"
import solidTransformPlugin from "@opentui/solid/bun-plugin"

/** Compile Solid's universal JSX once at build time, not on every CLI launch. */
export async function buildTui(outdir = fileURLToPath(new URL("./dist/", import.meta.url))) {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./src/tui/index.tsx", import.meta.url))],
    outdir,
    naming: "tui.js",
    target: "bun",
    format: "esm",
    conditions: ["browser"],
    // Native OpenTUI assets and runner singletons must stay in their own packages.
    packages: "external",
    plugins: [{
      name: "external-runner-singletons",
      setup(build) {
        // Resolve before tsconfig's typecheck-only paths can turn a package
        // import into a relative source file (which packages: external cannot catch).
        build.onResolve({ filter: /^@quark\/(runner|acp)(\/|$)/ }, (args) => ({
          path: args.path,
          external: true,
        }))
      },
    }, solidTransformPlugin],
    sourcemap: "linked",
  })
  if (!result.success) throw new AggregateError(result.logs, "TUI build failed")
  return result
}

if (import.meta.main) {
  const result = await buildTui()
  for (const output of result.outputs) console.log(`TUI ${output.path} (${output.size} bytes)`)
}
