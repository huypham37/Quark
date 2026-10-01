import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

/** Node-compatible bundles; workspace packages must retain their singleton state. */
export async function buildPackage(options: {
  root: URL
  entrypoints: string[]
  splitting?: boolean
  commonjs?: boolean
  executable?: boolean
}) {
  const root = fileURLToPath(options.root)
  const outdir = fileURLToPath(new URL("./dist/", options.root))
  await rm(outdir, { recursive: true, force: true })

  async function build(format: "esm" | "cjs", entries = options.entrypoints) {
    const result = await Bun.build({
      entrypoints: entries.map((entry) => fileURLToPath(new URL(entry, options.root))),
      root: `${root}/src`,
      outdir,
      target: "node",
      format,
      packages: "external",
      external: ["bun"],
      // tsconfig paths are for typechecking only. Intercept workspace imports
      // before Bun resolves those aliases to source and bundles a second engine.
      plugins: [{
        name: "external-workspace-packages",
        setup(build) {
          build.onResolve({ filter: /^@quark\/(runner|acp)(\/|$)/ }, ({ path }) => ({
            path,
            external: true,
          }))
        },
      }],
      splitting: format === "esm" && (options.splitting ?? false),
      naming: {
        entry: format === "esm" ? "[dir]/[name].js" : "[dir]/[name].cjs",
        chunk: "chunks/[name]-[hash].js",
      },
      sourcemap: "linked",
      ...(options.executable ? { banner: "#!/usr/bin/env node" } : {}),
    })
    if (!result.success) throw new AggregateError(result.logs, `${format} build failed`)
    for (const output of result.outputs) console.log(`${format.toUpperCase()} ${output.path} (${output.size} bytes)`)
  }

  await build("esm")
  if (options.commonjs) {
    // Only the root export advertises CommonJS; subpaths are ESM-only.
    await build("cjs", ["src/index.ts"])
  }
}
