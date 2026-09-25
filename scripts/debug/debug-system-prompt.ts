#!/usr/bin/env bun
// debug-system-prompt.ts — print and count tokens for the full assembled system prompt
//
// Mimics exactly what buildSystem() produces for a given profile.
// Usage:
//   bun scripts/debug-system-prompt.ts [profile-id]
//   bun scripts/debug-system-prompt.ts coder
//   bun scripts/debug-system-prompt.ts finder

import { encode } from "gpt-tokenizer"
import { buildSystem } from "../packages/runner/src/session/system"
import { materializeAgent } from "../packages/quark/src/agent-compat"
import { resolveProfile, readPromptFile } from "../packages/quark/src/profile/profile"

const profileId = process.argv[2] ?? "coder"

let agent
try {
  const profile = resolveProfile(profileId)
  const promptContent = readPromptFile(profile)
  agent = await materializeAgent(profile, promptContent.content)
} catch (e) {
  console.error(`Failed to load profile "${profileId}": ${e}`)
  process.exit(1)
}

const parts = buildSystem(agent)

console.log(`\n${"═".repeat(60)}`)
console.log(`  System prompt for profile: ${profileId}`)
console.log(`${"═".repeat(60)}\n`)

let totalTokens = 0

for (let i = 0; i < parts.length; i++) {
  const part = parts[i]
  const tokens = encode(part).length
  totalTokens += tokens
  const label = i === 0 ? "agent.prompt" : i === parts.length - 1 ? "environment block" : `block ${i}`

  console.log(`── Part ${i + 1}: ${label}  [${tokens.toLocaleString()} tokens]`)
  console.log(`${"─".repeat(60)}`)
  console.log(part)
  console.log()
}

console.log(`${"═".repeat(60)}`)
console.log(`  TOTAL system prompt tokens: ${totalTokens.toLocaleString()}`)
console.log(`  Parts: ${parts.length}`)
console.log(`${"═".repeat(60)}\n`)
