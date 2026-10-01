import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { buildPackage } from "../scripts/build-package"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "quark-package-build-"))
  directories.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, content)
  }
  return { path: root, url: pathToFileURL(`${root}/`) }
}

test("Node bundles preserve subpath identity, CommonJS exports, maps, and clean stale output", async () => {
  const root = await fixture({
    "package.json": '{"type":"module"}',
    "src/index.ts": 'export { state } from "./session/events"',
    "src/session/events.ts": "export const state = { count: 0 }",
    "dist/stale.js": "old build",
  })
  await buildPackage({
    root: root.url,
    entrypoints: ["src/index.ts", "src/session/events.ts"],
    splitting: true,
    commonjs: true,
  })
  expect(await Bun.file(join(root.path, "dist/stale.js")).exists()).toBe(false)
  expect(await Bun.file(join(root.path, "dist/index.js.map")).exists()).toBe(true)
  expect(await Bun.file(join(root.path, "dist/index.cjs.map")).exists()).toBe(true)
  const process = Bun.spawn(["node", "--input-type=module", "-e", `
    import { state } from ${JSON.stringify(pathToFileURL(join(root.path, "dist/index.js")).href)};
    import { state as subpath } from ${JSON.stringify(pathToFileURL(join(root.path, "dist/session/events.js")).href)};
    import { createRequire } from "node:module";
    if (state !== subpath) throw Error("duplicated state");
    const cjs = createRequire(import.meta.url)(${JSON.stringify(join(root.path, "dist/index.cjs"))});
    if (cjs.state.count !== 0) throw Error("broken CommonJS");
  `], { stdout: "pipe", stderr: "pipe" })
  const error = await new Response(process.stderr).text()
  expect(error).toBe("")
  expect(await process.exited).toBe(0)
})

test("CLI keeps workspace imports external despite tsconfig aliases and retains the Node shebang", async () => {
  const root = await fixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: {
      "@quark/runner": ["./src/poison.ts"],
      "@quark/acp": ["./src/poison.ts"],
    } } }),
    "src/poison.ts": 'throw Error("DUPLICATE_ENGINE"); export const value = 1',
    "src/cli.ts": 'import { value } from "@quark/runner"; import { value as acp } from "@quark/acp"; console.log(value, acp)',
  })
  await buildPackage({ root: root.url, entrypoints: ["src/cli.ts"], executable: true })
  const code = await readFile(join(root.path, "dist/cli.js"), "utf8")
  expect(code.startsWith("#!/usr/bin/env node\n")).toBe(true)
  expect(code).toContain('"@quark/runner"')
  expect(code).toContain('"@quark/acp"')
  expect(code).not.toContain("DUPLICATE_ENGINE")
})
