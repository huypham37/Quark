import { expect, test } from "bun:test"
import { resolve } from "node:path"

const debugFile = resolve(import.meta.dir, "../../packages/runner/src/debug.ts")
function probe(env: Record<string, string>) {
  return Bun.spawnSync({
    cmd: [process.execPath, "-e", `import { debug, setVerbose } from ${JSON.stringify(debugFile)}; const internal = debug('processor'); const tool = debug('tool-call'); console.log(JSON.stringify({ before: [internal.enabled, tool.enabled], after: (setVerbose(true), [internal.enabled, tool.enabled]) }));`],
    env: { ...process.env, QUARK_DEBUG: "", QUARK_VERBOSE: "", ...env },
  })
}

test("QUARK_VERBOSE is ignored; QUARK_DEBUG and --verbose remain effective", () => {
  expect(JSON.parse(probe({ QUARK_VERBOSE: "1" }).stdout.toString())).toEqual({ before: [false, false], after: [false, true] })
  expect(JSON.parse(probe({ QUARK_DEBUG: "*" }).stdout.toString()).before).toEqual([true, true])
})
