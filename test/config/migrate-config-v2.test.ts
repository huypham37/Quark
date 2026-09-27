import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse, stringify } from "yaml"
import { migrateConfigV2ToV3 } from "../../scripts/migrate-config-v2-to-v3"
import { parseProfile } from "../../packages/quark/src/agent/agent"
import { parseConfig } from "../../packages/quark/src/config/config"

function fixture(fn: (dir: string, file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-migrate-v2-"))
  const file = path.join(dir, "config.yaml")
  try { fn(dir, file) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
function write(file: string, profiles: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  fs.writeFileSync(file, stringify({ version: 2, models: { small: "openai/gpt-5" }, default_profile: "oracle", profiles, ...extras }))
}
const oracle = {
  name: "Oracle", description: "Thinks", model: { id: "openai/gpt-5", thinking: { effort: "high", mode: "enabled" } },
  tools: ["read"], skills: ["focus"], sub_agents: ["coder"], prompt_file: "oracle.md",
}

describe("V2 -> single-file profiles", () => {
  test("dry run is read-only; migration preserves metadata and prompt, backs up config, and repeats safely", () => fixture((dir, file) => {
    fs.writeFileSync(path.join(dir, "oracle.md"), "Exact instructions\n")
    write(file, { oracle }, { profile_overrides: { oracle: { tools_add: ["look"], skills_add: ["review"] } }, summary_detail: "quiet" })
    const before = fs.readFileSync(file, "utf8")
    const options = { configPath: file }
    expect(migrateConfigV2ToV3({ ...options, dryRun: true }).profiles).toEqual([path.join(dir, "profile", "oracle.yaml")])
    expect(fs.readdirSync(dir).sort()).toEqual(["config.yaml", "oracle.md"])
    const report = migrateConfigV2ToV3(options)
    expect(fs.readFileSync(report.backupPath!, "utf8")).toBe(before)
    const config = parse(fs.readFileSync(file, "utf8"))
    expect(config.version).toBe(3)
    expect(config.default_agent).toBe("oracle")
    expect(parseConfig(config).defaultAgent).toBe("oracle")
    expect(config.summary_detail).toBe("quiet")
    expect(config.profiles).toBeUndefined()
    expect(config.default_profile).toBeUndefined()
    const profile = parse(fs.readFileSync(report.profiles[0]!, "utf8"))
    expect(profile.prompt).toBe("Exact instructions\n")
    expect(profile.description).toBe("Thinks")
    expect(profile.model).toEqual({ id: "openai/gpt-5", thinking_effort: "high", thinking_mode: "enabled" })
    expect(profile.tools).toEqual(["read", "look"])
    expect(profile.skills).toEqual(["focus", "review"])
    expect(profile.subagents).toEqual(["coder"])
    expect(parseProfile(profile, "oracle").instructions).toBe("Exact instructions\n")
    expect(migrateConfigV2ToV3(options).changed).toBe(false)
  }))

  test("preflight refuses conflicts, invalid IDs, missing prompts and invalid default without writes", () => {
    for (const kind of ["existing", "bad-id", "missing-prompt", "bad-default", "bad-profile"]) fixture((dir, file) => {
      fs.writeFileSync(path.join(dir, "oracle.md"), "Prompt")
      const profiles: Record<string, unknown> = kind === "bad-id" ? { "../escape": oracle } :
        kind === "bad-profile" ? { oracle: "broken" } : { oracle: { ...oracle, ...(kind === "missing-prompt" ? { prompt_file: "gone.md" } : {}) } }
      write(file, profiles, kind === "bad-default" ? { default_profile: "unknown" } : {})
      const before = fs.readFileSync(file, "utf8")
      if (kind === "existing") {
        fs.mkdirSync(path.join(dir, "profile"))
        fs.writeFileSync(path.join(dir, "profile", "oracle.yaml"), "name: existing\n")
      }
      expect(() => migrateConfigV2ToV3({ configPath: file })).toThrow()
      expect(fs.readFileSync(file, "utf8")).toBe(before)
      expect(fs.readdirSync(dir).some(name => name.endsWith(".bak"))).toBe(false)
      if (kind === "existing") expect(fs.readFileSync(path.join(dir, "profile", "oracle.yaml"), "utf8")).toBe("name: existing\n")
    })
  })

  test("rejects invalid target config and unknown fields before writing a backup", () => {
    for (const extras of [
      { models: { small: "not-a-provider-model" } },
      { unrecognized_setting: "do not discard me" },
      { profile_overrides: { unknown: { tools_add: ["read"] } } },
    ]) fixture((dir, file) => {
      fs.writeFileSync(path.join(dir, "oracle.md"), "Prompt")
      write(file, { oracle }, extras)
      expect(() => migrateConfigV2ToV3({ configPath: file })).toThrow()
      expect(fs.readdirSync(dir).some(name => name.endsWith(".bak"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "profile", "oracle.yaml"))).toBe(false)
    })
  })

  test("never migrates a blank prompt into the built-in prompt", () => fixture((dir, file) => {
    fs.writeFileSync(path.join(dir, "oracle.md"), "  \n")
    write(file, { oracle })
    expect(() => migrateConfigV2ToV3({ configPath: file })).toThrow(/must not be empty/)
    expect(fs.existsSync(path.join(dir, "profile", "oracle.yaml"))).toBe(false)
  }))

  test("accepts an existing V3 default profile without overwriting it", () => fixture((dir, file) => {
    fs.mkdirSync(path.join(dir, "profile"))
    const existing = path.join(dir, "profile", "oracle.yaml")
    fs.writeFileSync(existing, stringify({ name: "Oracle", prompt: "Retain me" }))
    fs.writeFileSync(file, stringify({ version: 2, models: { small: "openai/gpt-5" }, default_profile: "oracle" }))
    const report = migrateConfigV2ToV3({ configPath: file })
    expect(report.profiles).toEqual([])
    expect(parseConfig(parse(fs.readFileSync(file, "utf8"))).defaultAgent).toBe("oracle")
    expect(fs.readFileSync(existing, "utf8")).toContain("Retain me")
  }))

  test("refuses a symlinked profile directory before writing", () => fixture((dir, file) => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "quark-migrate-external-"))
    try {
      fs.symlinkSync(external, path.join(dir, "profile"))
      fs.writeFileSync(path.join(dir, "oracle.md"), "Prompt")
      write(file, { oracle })
      expect(() => migrateConfigV2ToV3({ configPath: file })).toThrow(/not a regular directory/)
      expect(fs.readdirSync(external)).toEqual([])
    } finally { fs.rmSync(external, { recursive: true, force: true }) }
  }))

  test("migrates a V2 config with no inline profiles", () => fixture((dir, file) => {
    fs.writeFileSync(file, stringify({ version: 2, models: { small: "openai/gpt-5" } }))
    const report = migrateConfigV2ToV3({ configPath: file })
    expect(report.profiles).toEqual([])
    expect(parseConfig(parse(fs.readFileSync(file, "utf8"))).version).toBe(3)
    expect(fs.readFileSync(report.backupPath!, "utf8")).toContain("version: 2")
  }))

  test("refuses conflicting flat and nested thinking values", () => fixture((dir, file) => {
    fs.writeFileSync(path.join(dir, "oracle.md"), "Prompt")
    write(file, { oracle: { ...oracle, thinking_effort: "low" } })
    expect(() => migrateConfigV2ToV3({ configPath: file })).toThrow(/Conflicting profiles.oracle.thinking_effort/)
    expect(fs.existsSync(path.join(dir, "profile", "oracle.yaml"))).toBe(false)
  }))
})
