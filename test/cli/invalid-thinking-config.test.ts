// Tests for issue #166 — invalid thinking config should produce a clean
// startup error instead of an unhandled exception.
//
// These tests spawn the CLI binary as a subprocess with a temp project
// directory containing `.quark/agents/<id>/agent.yaml` manifests, and verify
// that agent thinking config is validated against the exact catalog:
//   1. an unsupported effort for a known model is reported clearly
//   2. a model missing from the catalog is reported clearly
//   3. a valid agent does not produce a spurious thinking-config error
//   4. an inactive agent's invalid config never fails the active run

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"

// ---------------------------------------------------------------------------
// Project root for spawning CLI
// ---------------------------------------------------------------------------
const PROJECT_ROOT = resolve(import.meta.dir, "../..")

// ---------------------------------------------------------------------------
// Temp project directory for isolated project agents
// ---------------------------------------------------------------------------
let tempProjectDir: string

beforeAll(() => {
  tempProjectDir = mkdtempSync(join(tmpdir(), "quark-issue-166-"))
})

afterAll(() => {
  rmSync(tempProjectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a project-level agent manifest at .quark/agents/<id>/agent.yaml. */
function writeAgent(id: string, yaml: string) {
  const dir = join(tempProjectDir, ".quark", "agents", id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "agent.yaml"), yaml, "utf-8")
}

/** Spawn the CLI entry point with given args, cwd = temp project dir. */
function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: [
      "bun",
      "--preload",
      join(PROJECT_ROOT, "packages", "quark", "preload.ts"),
      join(PROJECT_ROOT, "packages", "quark", "src", "cli.ts"),
      ...args,
    ],
    cwd: tempProjectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Prevent QUARK_DEBUG noise
      QUARK_DEBUG: "",
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI with invalid thinking config (issue #166)", () => {
  test("reports unsupported thinking effort for a known model", () => {
    // deepseek-v4-flash supports low/high/max — xhigh is not in the catalog.
    writeAgent("finder", `
name: Finder
model: opencode/deepseek-v4-flash
thinking_effort: xhigh
tools: [read]
`)

    const result = runCli(["--agent", "finder", "--message", "hello"])
    const stderr = result.stderr.toString()

    expect(result.exitCode).not.toBe(0)
    expect(stderr).toContain('Invalid reasoning effort "xhigh"')
  })

  test("reports a model that is not present in the exact catalog", () => {
    writeAgent("bad", `
name: Bad
model: copilot/gpt-4o
thinking_effort: high
tools: [read]
`)

    const result = runCli(["--agent", "bad", "--message", "hello"])
    const stderr = result.stderr.toString()

    expect(result.exitCode).not.toBe(0)
    expect(stderr).toContain("not present in the exact catalog")
  })

  test("valid thinking config does NOT cause a spurious error", () => {
    // deepseek-v4-pro supports: high, max
    writeAgent("good", `
name: Good
model: opencode/deepseek-v4-pro
thinking_effort: high
tools: [read]
`)

    const result = runCli(["--agent", "good", "--message", "hello"])
    const stderr = result.stderr.toString()

    // This test may fail for other reasons (no API key configured), but it
    // must NOT fail with a thinking-config error.
    expect(stderr).not.toContain("Invalid thinking effort")
    expect(stderr).not.toContain("Invalid reasoning effort")
    expect(stderr).not.toContain("Thinking is not supported")
    expect(stderr).not.toContain("at profile validation")
  })

  test("does not eagerly validate an inactive agent's thinking config", () => {
    writeAgent("badagent", `
name: Bad Agent
model: opencode/deepseek-v4-flash
thinking_effort: xhigh
tools: [read]
`)

    const result = runCli(["--agent", "coder", "--message", "hello"])
    const stderr = result.stderr.toString()

    // The active agent is the built-in coder: the broken manifest of another
    // agent must never be validated on its behalf.
    expect(stderr).not.toContain('Invalid reasoning effort "xhigh"')
    expect(stderr).not.toContain("not present in the exact catalog")
  })
})
