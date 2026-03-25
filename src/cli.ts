// CLI entry point for Atom
//
// Usage:
//   atom --profile coder --prompt "help me fix this bug"
//   atom -p coder -m "help me fix this bug"
//   atom "quick prompt without flags"

import { parseArgs } from "util"
import { bootstrap } from "./bootstrap"
import { prompt } from "./session/prompt"
import { resolveProfile, readPromptFile, listProfiles } from "./profile/profile"
import { agentFromProfile } from "./agent"
import { bus } from "./session/events"

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: atom [options] [prompt]

Options:
  -p, --profile <name>   Profile to use (default: from config)
  -m, --prompt <text>    Prompt text (alternative to positional)
  -s, --session <id>     Resume an existing session
  -l, --list-profiles    List available profiles
  -h, --help             Show this help message

Examples:
  atom --profile coder --prompt "fix the bug in main.ts"
  atom -p coder "fix the bug in main.ts"
  atom "quick question"
`)
}

interface ParsedArgs {
  profile?: string
  prompt?: string
  sessionId?: string
  listProfiles?: boolean
  help?: boolean
}

function parseArguments(): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      options: {
        profile: { type: "string", short: "p" },
        prompt: { type: "string", short: "m" },
        session: { type: "string", short: "s" },
        "list-profiles": { type: "boolean", short: "l" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    })

    // Positional argument is treated as prompt if --prompt not given
    const positionalPrompt = positionals.join(" ")
    const promptText = values.prompt ?? (positionalPrompt || undefined)

    return {
      profile: values.profile,
      prompt: promptText,
      sessionId: values.session,
      listProfiles: values["list-profiles"],
      help: values.help,
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArguments()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.listProfiles) {
    const profiles = listProfiles()
    console.log("Available profiles:")
    for (const p of profiles) {
      console.log(`  - ${p}`)
    }
    process.exit(0)
  }

  if (!args.prompt) {
    console.error("Error: No prompt provided")
    printHelp()
    process.exit(1)
  }

  // Resolve profile
  const profile = resolveProfile(args.profile)
  const systemPrompt = readPromptFile(profile)
  const agent = agentFromProfile(profile, systemPrompt)

  // Bootstrap with profile tools and skills
  await bootstrap({
    profileTools: profile.tools,
    boundSkills: profile.skills,
  })

  // Wire up basic event output for CLI
  bus.on("text-delta", ({ text }) => {
    process.stdout.write(text)
  })

  bus.on("tool-start", ({ toolId }) => {
    process.stdout.write(`\n[tool: ${toolId}]\n`)
  })

  bus.on("tool-end", ({ result }) => {
    if (result?.output) {
      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output)
      // Truncate long outputs
      const maxLen = 500
      const display = output.length > maxLen ? output.slice(0, maxLen) + "..." : output
      process.stdout.write(`${display}\n`)
    }
  })

  bus.on("error", ({ error }) => {
    console.error("\nError:", error)
  })

  bus.on("loop-end", () => {
    process.stdout.write("\n")
  })

  // Run the prompt
  try {
    const result = await prompt({
      sessionId: args.sessionId,
      parts: [{ type: "text", text: args.prompt }],
      agent,
    })

    console.log(`\n[session: ${result.sessionId}]`)
  } catch (err: any) {
    console.error("Error:", err.message)
    process.exit(1)
  }
}

main()
