import { describe, test, expect } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse, stringify } from "yaml"
import { migrateAgents } from "../../scripts/migrate-agents-to-profile"
import { parseProfile } from "../../packages/quark/src/agent/agent"

function fixture(run: (dir: string, agent: (id: string, manifest: object, prompt?: string) => void) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-agent-migration-"))
  const agent = (id: string, manifest: object, prompt?: string) => {
    const source = path.join(dir, "agents", id)
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, "agent.yaml"), stringify(manifest))
    if (prompt !== undefined) fs.writeFileSync(path.join(source, "instructions.md"), prompt)
  }
  try { run(dir, agent) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

describe("one-time agents → profile migration", () => {
  test("preserves fields, frontmatter and prompt; originals remain as backups", () => fixture((dir, agent) => {
    agent("oracle", { model: "openai/gpt-5", thinking_effort: "high", tools: ["read"], skills: ["focus"], sub_agents: ["coder"] }, "---\nname: Oracle\ndescription: Thinks\n---\n\nThink deeply.")
    expect(migrateAgents(dir, true)).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, "profile"))).toBe(false)
    migrateAgents(dir)
    const result = parseProfile(parse(fs.readFileSync(path.join(dir, "profile", "oracle.yaml"), "utf8")), "oracle")
    expect(result).toMatchObject({ name: "Oracle", description: "Thinks", model: "openai/gpt-5", thinkingEffort: "high", instructions: "Think deeply.", tools: ["read"], skills: ["focus"], subAgents: ["coder"] })
    expect(fs.existsSync(path.join(dir, "agents", "oracle", "instructions.md"))).toBe(true)
  }))

  test("preflights all sources and refuses conflicts without partial writes", () => fixture((dir, agent) => {
    agent("first", { name: "First" })
    agent("second", { model: "invalid" })
    expect(() => migrateAgents(dir)).toThrow(/provider\/model/)
    expect(fs.existsSync(path.join(dir, "profile", "first.yaml"))).toBe(false)
    agent("second", { name: "Second" })
    fs.mkdirSync(path.join(dir, "profile"))
    fs.writeFileSync(path.join(dir, "profile", "second.yaml"), "name: Existing\n")
    expect(() => migrateAgents(dir)).toThrow(/already exists/)
    expect(fs.existsSync(path.join(dir, "profile", "first.yaml"))).toBe(false)
  }))

  test("refuses unknown source fields rather than discarding them", () => fixture((dir, agent) => {
    agent("foo", { custom: "valuable" })
    expect(() => migrateAgents(dir)).toThrow(/Unknown/)
  }))
})
