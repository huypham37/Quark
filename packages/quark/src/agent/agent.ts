// Agent system — app-owned agent manifests, resolved into portable definitions.
//
// An agent is a directory:
//   agents/<id>/agent.yaml     identity: name, model, tools, skills, sub_agents
//   agents/<id>/instructions.md  system prompt (optional YAML frontmatter)
//
// Agents are app-owned: the loader scans
//   1. <config>/agents/            (global, ~/.config/quark/agents)
//   2. <cwd>/.quark/agents/        (project, overrides global)
// and always keeps the built-in `coder` fallback. This is deliberately NOT part
// of @quark/runner: the engine receives a portable AgentDefinition and never
// reads agent YAML.

import * as fs from "node:fs"
import * as path from "node:path"
import { parse as parseYAML } from "yaml"
import { buildSkillTool } from "@quark/runner/tool/skill"
import { createSubagentTool } from "@quark/runner/tool/subagent"
import { lookTool } from "@quark/runner/tool/look"
import { readTool } from "@quark/runner/tool/read"
import { questionTool } from "@quark/runner/tool/question"
import { profileSkills, type SkillDefinition } from "@quark/runner/skill/skill"
import { warn as notifyWarn } from "@quark/runner/notification/notification"
import { loadTools } from "../tool-loader"
import { configDir, loadConfig } from "../config/config"
import type { AgentDefinition } from "@quark/runner/agent"
import type { ToolDef } from "@quark/runner/tool/tool"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved agent manifest with its instructions already read from disk. */
export interface AgentDef {
  /** Unique agent id (directory name) */
  id: string
  /** Human-readable display name */
  name: string
  /** Short description from the manifest or instructions frontmatter */
  description?: string
  /** Resolved system-prompt text (never a file path) */
  instructions: string
  /** Tool IDs this agent can use */
  tools: string[]
  /** Skill names bound to this agent */
  skills: string[]
  /** Agent IDs this agent can delegate to */
  subAgents?: string[]
  /** Model spec in `provider/model` form */
  model?: string
  /** Thinking effort for this agent's effective model */
  thinkingEffort?: string
  /** Optional reasoning mode for models that support it */
  thinkingMode?: string
}

export const BUILTIN_TOOLS = ["read", "look", "write", "edit", "bash", "skill", "todo"]

export const BUILTIN_INSTRUCTIONS =
  "You are a coding assistant. Help the user with software engineering tasks."

const BUILTIN_CODER: AgentDef = {
  id: "coder",
  name: "Coder",
  instructions: BUILTIN_INSTRUCTIONS,
  tools: [...BUILTIN_TOOLS],
  skills: [],
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Global agents directory, resolved per call so QUARK_CONFIG_DIR stays authoritative. */
export function agentsDir(): string {
  return path.join(configDir(), "agents")
}

/** Project-level agents directory (overrides the global one per id). */
export function projectAgentsDir(): string {
  return path.resolve(process.cwd(), ".quark", "agents")
}

// ---------------------------------------------------------------------------
// instructions.md
// ---------------------------------------------------------------------------

/**
 * Split `instructions.md` into YAML frontmatter and body.
 *
 * The frontmatter block is parsed as real YAML (not line-wise `key: value`),
 * so block scalars like `description: |` keep their full text instead of
 * collapsing to a literal "|".
 */
function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const data: Record<string, string> = {}
  if (!raw.startsWith("---")) return { data, content: raw }

  const end = raw.indexOf("\n---", 3)
  if (end === -1) return { data, content: raw }

  const front = raw.substring(4, end)
  const content = raw.substring(end + 4).trim()

  let parsed: unknown
  try {
    parsed = parseYAML(front)
  } catch {
    return { data, content }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { data, content }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") data[key] = value.trim()
    else if (typeof value === "number" || typeof value === "boolean") data[key] = String(value)
  }

  return { data, content }
}

interface Instructions {
  content: string
  name?: string
  description?: string
}

function readInstructions(file: string): Instructions {
  try {
    const { data, content } = parseFrontmatter(fs.readFileSync(file, "utf-8"))
    return {
      content: content || BUILTIN_INSTRUCTIONS,
      ...(data.name ? { name: data.name } : {}),
      ...(data.description ? { description: data.description } : {}),
    }
  } catch {
    return { content: BUILTIN_INSTRUCTIONS }
  }
}

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

/** Parse one `agent.yaml`; throws only when the manifest is unusable. */
export function parseAgentManifest(raw: unknown, id: string, dir: string): AgentDef {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`agents/${id}/agent.yaml must be a mapping.`)
  }
  const manifest = raw as Record<string, unknown>
  const instructions = readInstructions(path.join(dir, "instructions.md"))

  return {
    id,
    name: nonEmptyString(manifest.name) ?? instructions.name ?? id,
    ...(nonEmptyString(manifest.description) ?? instructions.description
      ? { description: nonEmptyString(manifest.description) ?? instructions.description }
      : {}),
    instructions: instructions.content,
    tools: stringArray(manifest.tools) ?? [...BUILTIN_TOOLS],
    skills: stringArray(manifest.skills) ?? [],
    ...(stringArray(manifest.sub_agents) ? { subAgents: stringArray(manifest.sub_agents) } : {}),
    ...(nonEmptyString(manifest.model) ? { model: nonEmptyString(manifest.model) } : {}),
    ...(nonEmptyString(manifest.thinking_effort) ? { thinkingEffort: nonEmptyString(manifest.thinking_effort) } : {}),
    ...(nonEmptyString(manifest.thinking_mode) ? { thinkingMode: nonEmptyString(manifest.thinking_mode) } : {}),
  }
}

/** Scan one agents directory. Unreadable manifests are reported and skipped. */
export function loadAgentDir(dir: string): Record<string, AgentDef> {
  const agents: Record<string, AgentDef> = {}
  if (!fs.existsSync(dir)) return agents

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(dir, entry.name, "agent.yaml")
    if (!fs.existsSync(manifestPath)) continue
    try {
      const raw = parseYAML(fs.readFileSync(manifestPath, "utf-8"))
      agents[entry.name] = parseAgentManifest(raw, entry.name, path.join(dir, entry.name))
    } catch (error) {
      notifyWarn(
        "Agent",
        `Skipping agents/${entry.name}/agent.yaml: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      )
    }
  }

  return agents
}

/** All agents: built-in coder, then global, then project (later wins). */
export function loadAgents(): Record<string, AgentDef> {
  const agents: Record<string, AgentDef> = { [BUILTIN_CODER.id]: { ...BUILTIN_CODER } }
  const dirs = [agentsDir(), projectAgentsDir()]
  for (const dir of new Set(dirs)) {
    for (const [id, def] of Object.entries(loadAgentDir(dir))) agents[id] = def
  }
  return agents
}

/** List every available agent id, including the built-in fallback. */
export function listAgents(): string[] {
  return Object.keys(loadAgents())
}

/**
 * Resolve an agent by id.
 *
 * Order: explicit id → config `default_agent` → built-in `coder`.
 * Unknown `sub_agents` ids are warned about and stripped.
 */
export function resolveAgent(id?: string): AgentDef {
  const agents = loadAgents()
  const defaultId = loadConfig().defaultAgent ?? BUILTIN_CODER.id
  const requested = id ?? defaultId
  let agent = agents[requested] ?? agents[defaultId] ?? { ...BUILTIN_CODER }

  if (agent.subAgents && agent.subAgents.length > 0) {
    const known = Object.keys(agents)
    const valid = agent.subAgents.filter((sub) => known.includes(sub))
    const invalid = agent.subAgents.filter((sub) => !known.includes(sub))
    if (invalid.length > 0) {
      notifyWarn(
        "Agent",
        `Unknown sub-agent${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. Available agents: ${known.join(", ")}`,
        8000,
      )
      agent = { ...agent, subAgents: valid }
    }
  }

  return agent
}

// ---------------------------------------------------------------------------
// Materialization — resolved agent → portable AgentDefinition
// ---------------------------------------------------------------------------

/**
 * Injectable dependencies for {@link materializeAgent}.
 *
 * `resolveSkills` exists because skill discovery is a process-global cache;
 * tests use it to stay hermetic instead of mutating cwd/HOME.
 */
export interface MaterializeDeps {
  /** Resolve bound skill names to concrete definitions. Defaults to global discovery. */
  resolveSkills?: (names: string[]) => SkillDefinition[]
}

/**
 * Materialize a portable {@link AgentDefinition} from a resolved agent.
 *
 * Engine-owned tools (`read`, `look`, `skill`, `question`) come from
 * `@quark/runner`; the rest are imported from `<config>/tools/{id}.ts` without
 * registering them globally. Missing/invalid tools are skipped. Bound skills
 * attach to the definition and the synthesized `skill` tool.
 */
export async function materializeAgent(
  agent: AgentDef,
  deps: MaterializeDeps = {},
): Promise<AgentDefinition> {
  const skills: SkillDefinition[] = (deps.resolveSkills ?? profileSkills)(agent.skills)
  const { defs } = await loadTools(agent.tools, { register: false })
  const loaded = new Map(defs.map((def) => [def.id, def]))

  const tools: ToolDef[] = []
  for (const id of agent.tools) {
    if (id === "read") {
      tools.push(readTool)
    } else if (id === "look") {
      tools.push(lookTool)
    } else if (id === "skill") {
      tools.push(buildSkillTool(undefined, skills))
    } else if (id === "question") {
      tools.push(questionTool)
    } else {
      const def = loaded.get(id)
      if (def) tools.push(def)
    }
  }

  // Sub-agent delegation is an app concern: `sub_agents` becomes a concrete
  // tool carrying the allowed ids, so the engine never reads agent YAML and
  // the child process resolves its own agent.
  if (agent.subAgents && agent.subAgents.length > 0) {
    tools.push(createSubagentTool(agent.subAgents))
  }

  return {
    id: agent.id,
    name: agent.name,
    instructions: agent.instructions,
    tools,
    skills,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.thinkingEffort ? { thinkingEffort: agent.thinkingEffort } : {}),
    ...(agent.thinkingMode ? { thinkingMode: agent.thinkingMode } : {}),
  }
}

/** Exported for testing only. */
export const _internal = { BUILTIN_CODER, parseFrontmatter, readInstructions }
