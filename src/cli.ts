// CLI entry point for Atom
//
// Usage:
//   atom --profile coder --prompt "help me fix this bug"
//   atom -p coder -m "help me fix this bug"
//   atom "quick prompt without flags"
//   atom --sub-agent --profile researcher --prompt "research this topic"
//   atom --parent-session <id> --profile researcher --prompt "research this topic"

import { parseArgs } from "util"
import { bootstrap } from "./bootstrap"
import { prompt } from "./session/prompt"
import { resolveProfile, readPromptFile, listProfiles } from "./profile/profile"
import { agentFromProfile } from "./agent"
import { bus } from "./session/events"
import { startEventWriter } from "./session/event-writer"

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: atom [options] [prompt]

Options:
  -p, --profile <name>          Profile to use (default: from config)
  -m, --prompt <text>           Prompt text (alternative to positional)
  -s, --session <id>            Resume an existing session
      --parent-session <id>     Create a child session under this parent
      --sub-agent               Create a child session (reads ATOM_SESSION_ID from env)
  -l, --list-profiles           List available profiles
  -h, --help                    Show this help message

Examples:
  atom --profile coder --prompt "fix the bug in main.ts"
  atom -p coder "fix the bug in main.ts"
  atom "quick question"
  atom --sub-agent --profile researcher --prompt "research auth flow"
  atom --parent-session sess_abc --profile researcher --prompt "research auth flow"
`)
}

interface ParsedArgs {
  profile?: string
  prompt?: string
  sessionId?: string
  parentSessionId?: string
  subAgent?: boolean
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
        "parent-session": { type: "string" },
        "sub-agent": { type: "boolean" },
        "list-profiles": { type: "boolean", short: "l" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    })

    // Positional argument is treated as prompt if --prompt not given
    const positionalPrompt = positionals.join(" ")
    const promptText = values.prompt ?? (positionalPrompt || undefined)

    // Resolve parent session ID
    let parentSessionId: string | undefined = values["parent-session"]
    if (values["sub-agent"]) {
      if (parentSessionId) {
        console.error("Error: --sub-agent and --parent-session are mutually exclusive")
        process.exit(1)
      }
      parentSessionId = process.env.ATOM_SESSION_ID
      if (!parentSessionId) {
        console.error("Error: --sub-agent requires ATOM_SESSION_ID environment variable")
        process.exit(1)
      }
    }

    // --session and --parent-session are mutually exclusive
    if (values.session && parentSessionId) {
      console.error("Error: --session and --parent-session/--sub-agent are mutually exclusive")
      process.exit(1)
    }

    return {
      profile: values.profile,
      prompt: promptText,
      sessionId: values.session,
      parentSessionId,
      subAgent: values["sub-agent"],
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

  // When running as a sub-agent, stream structured events to stderr
  // so the parent's Bash tool can render sub-agent activity in the TUI.
  let cleanupEventWriter: (() => void) | undefined
  if (args.subAgent) {
    cleanupEventWriter = startEventWriter()
  }

  // Wire up basic event output for CLI
  bus.on("text-delta", ({ delta }) => {
    process.stdout.write(delta)
  })

  bus.on("tool-start", ({ tool }) => {
    process.stdout.write(`\n[tool: ${tool}]\n`)
  })

  bus.on("tool-end", (data) => {
    if (data.output) {
      const output = typeof data.output === "string" ? data.output : JSON.stringify(data.output)
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
      parentSessionId: args.parentSessionId,
      parts: [{ type: "text", text: args.prompt }],
      agent,
    })

    console.log(`\n[session: ${result.sessionId}]`)
  } catch (err: any) {
    console.error("Error:", err.message)
    process.exit(1)
  } finally {
    cleanupEventWriter?.()
  }
}

main()
