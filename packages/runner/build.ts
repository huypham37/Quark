import { buildPackage } from "../../scripts/build-package"
import manifest from "./package.json"

// Build every public subpath together so shared modules (especially the event
// bus) are emitted once. The exports map is the source of truth for entries.
await buildPackage({
  root: new URL("./", import.meta.url),
  entrypoints: Object.values(manifest.exports).map((entry) => entry.bun),
  splitting: true,
  commonjs: true,
})
