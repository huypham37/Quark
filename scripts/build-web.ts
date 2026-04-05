/**
 * Build the web client bundle.
 * Usage: bun scripts/build-web.ts
 */
import { copyFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

const outdir = resolve(import.meta.dirname, "../src/web/public")

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dirname, "../src/web/client/index.tsx")],
  outdir,
  naming: "bundle.js",
  target: "browser",
  format: "esm",
  minify: process.argv.includes("--minify"),
  sourcemap: "external",
})

if (!result.success) {
  console.error("Build failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Copy CSS to public directory
copyFileSync(
  resolve(import.meta.dirname, "../src/web/client/styles.css"),
  resolve(outdir, "styles.css"),
)

console.log("Web client built successfully →", outdir)
