import { buildPackage } from "../../scripts/build-package"
import { buildTui } from "./build-tui"

await buildPackage({
  root: new URL("./", import.meta.url),
  entrypoints: ["src/cli.ts"],
  executable: true,
})
await buildTui()
