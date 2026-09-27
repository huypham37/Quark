// One-time offline migration from agents/<id>/{agent.yaml,instructions.md}
// to profile/<id>.yaml. Retain source directories as backups; no runtime fallback.
// Retirement condition: remove this script once all supported installs have migrated.
// Usage: bun scripts/migrate-agents-to-profile.ts [--dry-run] [--config-dir <path>]
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse, stringify } from "yaml"
import { pathToFileURL } from "node:url"
import { parseProfile } from "../packages/quark/src/agent/agent"

export interface MigrationPlan {
  source: string
  destination: string
  content: string
}

/** Require a YAML mapping so malformed manifests fail before any writes. */
function mapping(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a mapping.`)
  return value as Record<string, unknown>
}

/** Read an optional string without altering prompt or metadata contents. */
function text(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  return value
}

/** Reject malformed lists instead of silently dropping their entries. */
function array(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings.`)
  return value
}

/** Preflight every source and destination before writing anything. */
export function planAgentMigration(configDir: string): MigrationPlan[] {
  const sourceDir = path.join(configDir, "agents")
  const targetDir = path.join(configDir, "profile")
  if (!fs.existsSync(sourceDir)) return []
  const result: MigrationPlan[] = []
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) throw new Error(`Unexpected entry in agents/: ${entry.name}`)
    const id = entry.name
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id === "." || id === "..") throw new Error(`Invalid agent id: ${id}`)
    const source = path.join(sourceDir, id)
    const destination = path.join(targetDir, `${id}.yaml`)
    if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`)
    const files = fs.readdirSync(source)
    if (files.some((file) => !["agent.yaml", "instructions.md"].includes(file))) {
      throw new Error(`Unexpected files in ${source}; refusing to discard data.`)
    }
    const manifestPath = path.join(source, "agent.yaml")
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}`)
    const manifest = mapping(parse(fs.readFileSync(manifestPath, "utf8")), manifestPath)
    const allowed = new Set(["name", "description", "model", "thinking_effort", "thinking_mode", "tools", "skills", "sub_agents"])
    for (const key of Object.keys(manifest)) if (!allowed.has(key)) throw new Error(`Unknown ${manifestPath} field: ${key}`)
    const model = text(manifest.model, "model")
    const effort = text(manifest.thinking_effort, "thinking_effort")
    const mode = text(manifest.thinking_mode, "thinking_mode")
    const instructionsPath = path.join(source, "instructions.md")
    // Frontmatter previously supplied name/description. Preserve it as YAML fields.
    let prompt = fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, "utf8") : undefined
    let front: Record<string, unknown> = {}
    if (prompt?.startsWith("---\n")) {
      const end = prompt.indexOf("\n---", 3)
      if (end !== -1) {
        front = mapping(parse(prompt.slice(4, end)), instructionsPath)
        prompt = prompt.slice(end + 4).trim()
      }
    }
    for (const key of Object.keys(front)) if (!["name", "description"].includes(key)) throw new Error(`Unknown frontmatter field: ${key}`)
    const profile = {
      name: text(manifest.name, "name") ?? text(front.name, "frontmatter.name") ?? id,
      ...(text(manifest.description, "description") ?? text(front.description, "frontmatter.description") ? {
        description: text(manifest.description, "description") ?? text(front.description, "frontmatter.description"),
      } : {}),
      ...(model || effort || mode ? { model: { ...(model ? { id: model } : {}), ...(effort ? { thinking_effort: effort } : {}), ...(mode ? { thinking_mode: mode } : {}) } } : {}),
      tools: array(manifest.tools, "tools") ?? ["read", "look", "write", "edit", "bash", "skill", "todo"],
      skills: array(manifest.skills, "skills") ?? [],
      ...(array(manifest.sub_agents, "sub_agents") ? { subagents: array(manifest.sub_agents, "sub_agents") } : {}),
      ...(prompt !== undefined ? { prompt: prompt || "You are a coding assistant. Help the user with software engineering tasks." } : {}),
    }
    parseProfile(profile, id)
    const content = stringify(profile)
    parseProfile(parse(content), id)
    result.push({ source, destination, content })
  }
  return result
}

/** Originals remain untouched as a recovery backup. On error remove newly created outputs. */
export function migrateAgents(configDir: string, dryRun = false): MigrationPlan[] {
  const plan = planAgentMigration(configDir)
  if (dryRun || plan.length === 0) return plan
  const created: string[] = []
  try {
    fs.mkdirSync(path.join(configDir, "profile"), { recursive: true, mode: 0o700 })
    for (const item of plan) {
      fs.writeFileSync(item.destination, item.content, { encoding: "utf8", mode: 0o600, flag: "wx" })
      created.push(item.destination)
    }
  } catch (error) {
    for (const file of created) fs.rmSync(file, { force: true })
    throw error
  }
  return plan
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  let dir = process.env.QUARK_CONFIG_DIR ?? path.join(os.homedir(), ".config", "quark")
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true
    else if (args[i] === "--config-dir" && args[i + 1]) dir = args[++i]!
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  for (const item of migrateAgents(dir, dryRun)) console.log(`${dryRun ? "[dry-run] " : ""}${item.source} -> ${item.destination}`)
  console.log("Original agents/ directories retained as backup. Remove after verifying profiles.")
}
