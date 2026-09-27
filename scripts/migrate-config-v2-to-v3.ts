// Offline V2 inline profiles -> V3 single-file profile/<id>.yaml migration.
// Usage: bun scripts/migrate-config-v2-to-v3.ts [--dry-run] [--config <path>]
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse, stringify } from "yaml"
import { parseProfile } from "../packages/quark/src/agent/agent"
import { parseConfig } from "../packages/quark/src/config/config"

export interface MigrateOptions {
  configPath: string
  dryRun?: boolean
}
export interface MigrateReport {
  changed: boolean
  dryRun: boolean
  defaultAgent: string
  profiles: string[]
  backupPath?: string
}

const ID = /^[a-z0-9][a-z0-9._-]*$/
function validId(id: string): boolean {
  return ID.test(id) && id !== "." && id !== ".." && !id.endsWith(".")
}
function mapping(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a mapping.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`)
  return value
}
function oneValue(label: string, ...values: unknown[]): string | undefined {
  const supplied = values.filter(value => value !== undefined).map(value => text(value, label)!)
  if (new Set(supplied).size > 1) throw new Error(`Conflicting ${label} values; resolve before migrating.`)
  return supplied[0]
}
function list(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw new Error(`${label} must be an array of strings.`)
  return value
}
function absent(file: string): boolean {
  try { fs.lstatSync(file); return false } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    throw error
  }
}

/** All source reads, validation and collision checks happen before the first write. */
export function migrateConfigV2ToV3(options: MigrateOptions): MigrateReport {
  const configPath = path.resolve(options.configPath)
  const profileDir = path.join(path.dirname(configPath), "profile")
  const original = fs.readFileSync(configPath, "utf8")
  const config = mapping(parse(original), configPath)
  if (config.version === 3) {
    parseConfig(config)
    return { changed: false, dryRun: !!options.dryRun, defaultAgent: String(config.default_agent ?? "coder"), profiles: [] }
  }
  if (config.version !== 2) throw new Error(`Expected version: 2; found ${String(config.version)}.`)
  const profiles = config.profiles === undefined ? {} : mapping(config.profiles, "profiles")
  const overrides = config.profile_overrides === undefined ? {} : mapping(config.profile_overrides, "profile_overrides")
  const allowedConfig = new Set(["version", "models", "max_steps", "branching", "providers", "hide_readonly_tools", "editor", "summary_detail", "profiles", "default_profile", "profile_overrides"])
  for (const key of Object.keys(config)) if (!allowedConfig.has(key)) throw new Error(`Unknown config field: ${key}; refusing to discard data.`)
  if (config.default_agent !== undefined) throw new Error("Conflicting default_agent and default_profile; resolve manually.")
  const defaultAgent = text(config.default_profile, "default_profile") ?? "coder"
  if (!validId(defaultAgent)) throw new Error(`Invalid default agent ID: ${defaultAgent}`)
  if (defaultAgent !== "coder" && !Object.hasOwn(profiles, defaultAgent)) {
    // An existing V3 profile can also satisfy the default, checked below.
    const existing = path.join(profileDir, `${defaultAgent}.yaml`)
    if (absent(existing)) throw new Error(`Default agent ${defaultAgent} has no profile.`)
    if (!fs.lstatSync(existing).isFile()) throw new Error(`Default agent profile is not a regular file: ${existing}`)
    parseProfile(parse(fs.readFileSync(existing, "utf8")), defaultAgent)
  }
  if (!absent(profileDir) && !fs.lstatSync(profileDir).isDirectory()) throw new Error(`${profileDir} is not a regular directory.`)
  const outputs: { file: string; content: string }[] = []
  const configDir = path.dirname(configPath)
  for (const [id, raw] of Object.entries(profiles)) {
    if (!validId(id)) throw new Error(`Invalid profile ID: ${id}`)
    const profile = mapping(raw, `profiles.${id}`)
    const allowed = new Set(["name", "description", "model", "thinking_effort", "thinking_mode", "tools", "skills", "sub_agents", "subagents", "prompt", "prompt_file"])
    for (const key of Object.keys(profile)) if (!allowed.has(key)) throw new Error(`Unknown profiles.${id}.${key}; refusing to discard data.`)
    const legacyModel = typeof profile.model === "object" && profile.model !== null ? mapping(profile.model, `profiles.${id}.model`) : undefined
    if (legacyModel) for (const key of Object.keys(legacyModel)) if (!["id", "thinking", "thinking_effort", "thinking_mode"].includes(key)) throw new Error(`Unknown profiles.${id}.model.${key}`)
    const thinking = legacyModel?.thinking === undefined ? undefined : mapping(legacyModel.thinking, `profiles.${id}.model.thinking`)
    if (thinking) for (const key of Object.keys(thinking)) if (!["effort", "mode"].includes(key)) throw new Error(`Unknown thinking field: ${key}`)
    const modelId = text(legacyModel ? legacyModel.id : profile.model, `profiles.${id}.model`)
    const effort = oneValue(`profiles.${id}.thinking_effort`, profile.thinking_effort, legacyModel?.thinking_effort, thinking?.effort)
    const mode = oneValue(`profiles.${id}.thinking_mode`, profile.thinking_mode, legacyModel?.thinking_mode, thinking?.mode)
    if (profile.sub_agents !== undefined && profile.subagents !== undefined) throw new Error(`Conflicting sub-agent fields for ${id}`)
    if (profile.prompt !== undefined && profile.prompt_file !== undefined) throw new Error(`Conflicting prompt and prompt_file for ${id}`)
    const promptFile = text(profile.prompt_file, `profiles.${id}.prompt_file`)
    const promptPath = promptFile ? path.resolve(configDir, promptFile) : undefined
    if (promptPath && (absent(promptPath) || !fs.lstatSync(promptPath).isFile())) throw new Error(`Prompt is missing or not a regular file: ${promptPath}`)
    const prompt = promptPath ? fs.readFileSync(promptPath, "utf8") : text(profile.prompt, `profiles.${id}.prompt`)
    if (prompt !== undefined && !prompt.trim()) throw new Error(`profiles.${id}.prompt must not be empty; resolve before migrating.`)
    const override = overrides[id] === undefined ? {} : mapping(overrides[id], `profile_overrides.${id}`)
    for (const key of Object.keys(override)) if (!["skills_add", "tools_add"].includes(key)) throw new Error(`Unknown profile_overrides.${id}.${key}`)
    const tools = list(profile.tools, `profiles.${id}.tools`) ?? []
    const skills = list(profile.skills, `profiles.${id}.skills`) ?? []
    const yaml = {
      name: text(profile.name, `profiles.${id}.name`) ?? id,
      ...(text(profile.description, `profiles.${id}.description`) ? { description: profile.description } : {}),
      ...(modelId || effort || mode ? { model: { ...(modelId ? { id: modelId } : {}), ...(effort ? { thinking_effort: effort } : {}), ...(mode ? { thinking_mode: mode } : {}) } } : {}),
      tools: [...new Set([...tools, ...(list(override.tools_add, `profile_overrides.${id}.tools_add`) ?? [])])],
      skills: [...new Set([...skills, ...(list(override.skills_add, `profile_overrides.${id}.skills_add`) ?? [])])],
      ...(profile.sub_agents !== undefined || profile.subagents !== undefined ? { subagents: list(profile.sub_agents ?? profile.subagents, `profiles.${id}.sub_agents`) } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
    }
    parseProfile(yaml, id)
    const file = path.join(profileDir, `${id}.yaml`)
    if (!absent(file)) throw new Error(`Destination already exists: ${file}. Resolve the conflict before migrating.`)
    outputs.push({ file, content: stringify(yaml) })
  }
  for (const id of Object.keys(overrides)) if (!Object.hasOwn(profiles, id)) throw new Error(`Orphan profile_overrides.${id}`)
  const migrated = { ...config, version: 3, default_agent: defaultAgent }
  delete migrated.profiles
  delete migrated.default_profile
  delete migrated.profile_overrides
  const content = stringify(migrated)
  parseConfig(mapping(parse(content), "migrated config"))
  const report: MigrateReport = { changed: true, dryRun: !!options.dryRun, defaultAgent, profiles: outputs.map(o => o.file) }
  if (options.dryRun) return report

  // Keep an exclusive, verified backup. Roll back every created output on failure.
  const backupPath = `${configPath}.v2.${Date.now()}.${process.pid}.bak`
  const temp = `${configPath}.tmp.${process.pid}.${Date.now()}`
  const created: string[] = []
  let committed = false
  try {
    fs.writeFileSync(backupPath, original, { flag: "wx", mode: 0o600 })
    if (fs.readFileSync(backupPath, "utf8") !== original) throw new Error("Backup verification failed.")
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
    for (const output of outputs) {
      const fd = fs.openSync(output.file, "wx", 0o600)
      created.push(output.file)
      try { fs.writeFileSync(fd, output.content) } finally { fs.closeSync(fd) }
    }
    fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 })
    fs.renameSync(temp, configPath)
    committed = true
  } catch (error) {
    if (!committed) for (const file of created) fs.rmSync(file, { force: true })
    throw error
  } finally {
    fs.rmSync(temp, { force: true })
  }
  report.backupPath = backupPath
  return report
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    let configPath = path.join(process.env.QUARK_CONFIG_DIR ?? path.join(os.homedir(), ".config", "quark"), "config.yaml")
    let dryRun = false
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dry-run") dryRun = true
      else if (args[i] === "--config" && args[i + 1]) configPath = args[++i]!
      else throw new Error(`Unknown or incomplete argument: ${args[i]}`)
    }
    const report = migrateConfigV2ToV3({ configPath, dryRun })
    console.log(report.changed ? `${dryRun ? "[dry-run] " : ""}Migrated ${report.profiles.length} profiles; default: ${report.defaultAgent}; backup: ${report.backupPath ?? "not written"}` : "Already V3; no changes.")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
