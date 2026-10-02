import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTui } from "../../packages/quark/build-tui"
import { tuiLaunchArgs } from "../../packages/quark/src/tui-launch"

const directories: string[] = []
function temporaryDir() {
  const dir = mkdtempSync(join(tmpdir(), "quark-tui-build-"))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("compiled TUI", () => {
  test("builds executable JS with JSX already transformed and runner/native packages external", async () => {
    const dist = temporaryDir()
    const result = await buildTui(dist)
    expect(result.success).toBe(true)
    const code = readFileSync(join(dist, "tui.js"), "utf8")
    expect(code).toContain("@opentui/solid")
    expect(code).toContain("@opentui/core")
    expect(code).toContain("@quark/runner/session/events")
    expect(code).not.toContain("@babel/core")
    expect(code).not.toContain("@opentui/solid/preload")
    expect(code).not.toMatch(/from ["'][^"']+\.tsx["']/)
    expect(code).not.toContain("<App")
    expect(code).not.toContain("function createRunner(")
    expect(code).not.toMatch(/\/\/ .*\/runner\/src\//)
    // Every retained runner import must be a real package export, not a
    // typecheck-only tsconfig alias that happens to work in this checkout.
    const runnerPackage = JSON.parse(readFileSync(new URL("../../packages/runner/package.json", import.meta.url), "utf8"))
    for (const [, specifier] of code.matchAll(/from ["'](@quark\/runner[^"']*)["']/g)) {
      const exportKey = "." + specifier!.slice("@quark/runner".length)
      expect(runnerPackage.exports[exportKey]).toBeDefined()
      expect(() => Bun.resolveSync(specifier!, import.meta.dir)).not.toThrow()
    }
    // Parsing the entire artifact as JS rejects untransformed JSX/TypeScript.
    const transpiled = new Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(code)
    expect(transpiled.length).toBeGreaterThan(0)
  }, 30_000)

  test("requires the compiled entrypoint instead of silently compiling source at launch", () => {
    expect(() => tuiLaunchArgs(temporaryDir(), {})).toThrow("Compiled TUI is missing")
  })

  test("forwards flags and forces browser Solid even outside a checkout", async () => {
    const dir = temporaryDir()
    await Bun.write(join(dir, "dist", "tui.js"), "// compiled fixture")
    const args = tuiLaunchArgs(dir, { agent: "researcher", sessionId: "abc", model: "openai/gpt-5" })
    expect(args).toEqual([
      "--conditions=browser", join(dir, "dist", "tui.js"),
      "--agent", "researcher", "--session", "abc", "--model", "openai/gpt-5",
    ])
    expect(args).not.toContain("--preload")
    expect(args.some((arg) => arg.endsWith(".tsx"))).toBe(false)
    expect(tuiLaunchArgs(dir, {})).toEqual(["--conditions=browser", join(dir, "dist", "tui.js")])
  })
})
