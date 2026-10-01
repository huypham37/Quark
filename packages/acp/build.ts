import { buildPackage } from "../../scripts/build-package"

await buildPackage({
  root: new URL("./", import.meta.url),
  entrypoints: ["src/index.ts"],
  commonjs: true,
})
