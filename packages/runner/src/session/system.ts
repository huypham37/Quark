// System prompt builder
//
// Assembles the system prompt from:
// 1. Ambient instructions — explicit text from the caller (the app opts into
//    AGENTS.md reads by passing `loadAmbientInstructions`)
// 2. Agent instructions + optional persona
// 3. L1 skill metadata (name + description for concrete SkillDefinitions)
// 4. Environment info (cwd, OS, date)
//
// The engine never reads a config file, profile, or prompt path.

import * as os from "os"
import type { SkillDefinition } from "../skill/skill"

/**
 * Explicit inputs for {@link buildSystem}.
 *
 * An {@link import("../agent").AgentDefinition} is structurally assignable to
 * this shape, so the portable path supplies resolved values directly.
 */
export interface SystemPromptInput {
  /** Resolved system-prompt text (never a config path) */
  instructions: string
  /** Optional short persona/role line */
  persona?: string
  /** Concrete skill metadata for the L1 block */
  skills?: SkillDefinition[]
}

/**
 * Ambient instruction text supplied explicitly by the caller.
 *
 * A plain string or string[] is included verbatim; a builder is called to
 * produce the text (returning `null`/`[]` for none). Omitting `ambient` (or
 * passing `null`) means "no ambient instructions" and performs no file reads.
 */
export type AmbientPromptBuilder = () => string | string[] | null | undefined

/** Explicit ambient/project instructions: text, a list of blocks, or a builder. */
export type AmbientInstructions = string | string[] | AmbientPromptBuilder

export function buildSystem(
  input: SystemPromptInput,
  ambient?: AmbientInstructions | null,
): string[] {
  const parts: string[] = []

  // Ambient/project instructions: only what the caller supplied. The engine
  // never silently depends on cwd/home.
  for (const block of resolveAmbientInstructions(ambient)) parts.push(block)

  // Agent identity + resolved prompt
  if (input.persona) parts.push(`# Persona\n\n${input.persona}`)
  parts.push(input.instructions)

  // L1 skill metadata
  const skillBlock = buildSkillBlock(input.skills ?? [])
  if (skillBlock) parts.push(skillBlock)

  parts.push(environmentBlock())
  return parts
}

function buildSkillBlock(skills: SkillDefinition[]): string | null {
  if (skills.length === 0) return null

  const lines = skills.map((s) => `- **${s.name}**: ${s.description}`)
  return [
    "# Available Skills",
    "",
    "Use the `skill` tool to load any of these when needed:",
    ...lines,
  ].join("\n")
}

function environmentBlock(): string {
  return [
    "# Environment",
    "",
    `Working directory: ${process.cwd()}`,
    `OS: ${os.platform()} (${os.release()}) on ${os.arch()}`,
    `Today's date: ${new Date().toDateString()}`,
  ].join("\n")
}

/**
 * Resolve the ambient block(s). `undefined`/`null` = none. Explicit text is
 * trimmed and blank blocks are dropped.
 */
function resolveAmbientInstructions(ambient?: AmbientInstructions | null): string[] {
  if (ambient == null) return []
  const resolved = typeof ambient === "function" ? ambient() : ambient
  const list = resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved]
  return list.map((block) => block.trim()).filter(Boolean)
}
