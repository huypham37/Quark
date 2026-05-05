# Quark

> A powerful AI coding agent — run from the terminal or embed as an SDK.

Quark is an agent harness: it owns the loop, the tools, the memory, and the guardrails. The model is a pluggable component. You bring your workflow; Quark adapts to it through tools you define.

---

## Install

```bash
npm i -g @quark/sdk
```

Requires **Bun** runtime.

---

## CLI

```bash
# One-shot prompt
quark "fix the null pointer in main.ts"

# Explicit profile
quark --profile coder "refactor the auth module"

# Resume a previous session
quark --session sess_abc123 "continue from where we left off"

# Use a specific model for this run
quark --model claude-sonnet-4.5 "quick question"

# Ephemeral run — nothing written to disk
quark --no-store "scratch-pad question"

# Spawn a child/sub-agent (links to parent via QUARK_SESSION_ID)
quark --sub-agent --profile researcher --prompt "research the auth flow"

# List available profiles
quark --list-profiles

# Launch the interactive TUI
quark
```

### Flags

| Flag | Short | Description |
|---|---|---|
| `--profile <name>` | `-p` | Profile to use |
| `--prompt <text>` | `-m` | Prompt text (positional arg also works) |
| `--session <id>` | `-s` | Resume an existing session |
| `--model <id>` | | Model override for this run (`provider/model` or bare `model`) |
| `--parent-session <id>` | | Create a child session under a parent |
| `--sub-agent` | | Mark as a child agent (reads `QUARK_SESSION_ID` from env) |
| `--no-store` | | Ephemeral session — never written to disk |
| `--verbose` | | Enable all debug logs (alias for `QUARK_DEBUG=*`) |
| `--list-profiles` | `-l` | List available profiles |
| `--help` | `-h` | Show help |

---

## Debugging

Quark uses **namespaced debug logs**. Logs are off by default and go to **stderr** (stdout stays clean for the assistant's reply). Enable per-subsystem with the `QUARK_DEBUG` env var:

```bash
QUARK_DEBUG=processor quark "..."             # only processor events
QUARK_DEBUG=processor,loop quark "..."        # multiple namespaces
QUARK_DEBUG='*' quark "..."                   # everything (or pass --verbose)
QUARK_DEBUG='*,-copilot-sse' quark "..."      # everything except SSE dump
```

The env var inherits to child processes (sub-agents, bash tool) automatically.

### Available namespaces

| Namespace | What it logs |
|---|---|
| `processor` | Every `fullStream` event, finish-step reasons, and the `continue` / `stop` / `compact` return value |
| `loop` | Each agent loop iteration, message/part counts, role+type summary of model messages, `processStream` result |
| `cli` | `text-start` / `text-delta` / `text-end` and `assistant-message-start` / `assistant-message-end` events |
| `models` | Context window resolution from models.dev (cache hit, fallback search, not-found) |
| `compaction` | Context window calc and compaction trigger decisions |
| `copilot-sse` | Raw Copilot SSE stream tee — very verbose; use to debug streaming bugs |
| `plugin` | Plugin loader output (suppressed unless enabled) |

To add a new namespace, just call `debug("my-ns")` from anywhere and document it in the table above and in the comment block at the top of [`src/debug.ts`](src/debug.ts).

---

## Profiles

Profiles define agent identity: a system prompt, a set of tools, and a set of skills. Only what a profile declares is loaded — no noise from unrelated tools.

| Profile | Purpose |
|---|---|
| `coder` | File editing, bash execution, todo tracking |
| `researcher` | Web search and content fetching |
| `finder` | Codebase exploration and discovery |
| `test-engineer` | Test planning and specification writing |

Define custom profiles in your config:

```yaml
# ~/.config/quark/config.yaml
profiles:
  coder:
    prompt_file: profiles/coder.md
    tools: [read, write, edit, bash, todo]
    skills: [code-review]
    model: copilot/claude-sonnet-4.5   # optional per-profile model
```

Profile prompt files are Markdown with optional frontmatter:

```markdown
---
name: Coder
description: File editing and bash execution agent
---

You are a coding agent. Use the tools available to read, edit, and run code.
```

---

## Configuration

Global config lives at `~/.config/quark/config.yaml`. Per-project overrides go in `.quark/config.yaml` at the repo root.

```yaml
# ~/.config/quark/config.yaml

main_model: claude-sonnet-4.5      # model used in the agent loop
small_model: gpt-4o-mini           # lightweight tasks (title generation, etc.)

# optional model list for the /model TUI picker
models:
  - gpt-4o
  - claude-sonnet-4.5
  - gemini-2.5-pro

max_steps: 100                     # max agent loop iterations per session
context_window: 100000             # fallback token budget (when model info unavailable)

compact:
  auto: true                       # auto-compact when token usage is high
  threshold: 0.95                  # compact at 95% of context window
  retain_turns: 5                  # keep last N turn pairs verbatim
  method: general

providers:
  ollama:
    baseURL: http://localhost:11434/v1
    apiKey: env:OLLAMA_API_KEY     # "env:VAR" reads from environment

profiles:
  coder:
    prompt_file: profiles/coder.md
    tools: [read, write, edit, bash, todo, skill]
    skills: [code-review]
```

### Model strings

Models use a `provider/model` format. If no provider prefix is given, `copilot` is used.

```
gpt-4o                     → copilot/gpt-4o
claude-sonnet-4.5          → copilot/claude-sonnet-4.5
ollama/llama3.2            → ollama provider, llama3.2 model
```

### Project overrides

Project config can extend a profile's tool and skill set:

```yaml
# .quark/config.yaml
profile_overrides:
  coder:
    tools_add: [deploy, test-runner]
    skills_add: [django-patterns]
```

---

## Tools

Tools are the adaptation layer. They let the agent act on your system — read files, run commands, call APIs, deploy code. The harness stays generic; your tools make it specific.

### Built-in tools

| Tool | Description |
|---|---|
| `read` | Read a file or directory |
| `skill` | Load a skill's instructions into context |
| `compact` | Summarize session history to free context space |

### External tools

Drop a `.ts` file in `~/.config/quark/tools/` and declare its ID in your profile:

```typescript
// ~/.config/quark/tools/deploy.ts
import { defineTool } from '@quark/sdk'
import { z } from 'zod'

export default defineTool({
  id: 'deploy',
  description: 'Deploy the current branch to staging',
  parameters: z.object({
    env: z.enum(['staging', 'prod']).describe('Target environment'),
  }),
  execute: async ({ env }) => {
    // your deploy logic
    return `Deployed to ${env}`
  },
})
```

Then declare it in your profile:

```yaml
profiles:
  coder:
    tools: [read, write, edit, bash, deploy]
```

Several ready-to-use example tools ship in `examples/tools/`:

| Tool | File |
|---|---|
| `bash` | `bash.ts` |
| `edit` | `edit.ts` |
| `glob` | `glob.ts` |
| `grep` | `grep.ts` |
| `todo` | `todo.ts` |
| `websearch` | `websearch.ts` |
| `write` | `write.ts` |

---

## Skills

Skills are Markdown instruction packs loaded on demand. They let you give the agent domain-specific knowledge without bloating the system prompt.

### Structure

```
~/.config/quark/skills/
  code-review/
    SKILL.md
  django-patterns/
    SKILL.md
    references/
      model-guide.md

.quark/skills/              # project-level skills
  deploy-runbook/
    SKILL.md
```

### SKILL.md format

```markdown
---
name: code-review
description: Structured code review checklist and conventions
---

## Code Review Checklist

1. Check for logic errors...
2. Verify error handling...
```

### Loading model

| Level | When | What loads |
|---|---|---|
| L1 Metadata | Profile activation | `name` + `description` injected into system prompt |
| L2 Instructions | Agent calls the `skill` tool | Full SKILL.md body enters context |
| L3 Resources | As needed | Reference files on disk (never auto-loaded) |

Profile-bound skills advertise their metadata automatically. Skills outside the active profile are not visible unless explicitly discovered.

---

## Plugins

Plugins extend Quark's behavior by hooking into the agent lifecycle. Drop a `.ts` file in `~/.config/quark/plugins/`:

```typescript
// ~/.config/quark/plugins/fallback-model.ts
import type { PluginFn } from '@quark/sdk'

const plugin: PluginFn = async (ctx) => ({
  'provider.request.error': async (input, output) => {
    if (input.statusCode === 429) {
      output.retry = true
      output.model = 'gpt-4o-mini'
    }
  },
})

export default plugin
```

Plugins can also register providers programmatically:

```typescript
const plugin: PluginFn = async (ctx) => {
  ctx.registerProvider('myprovider', {
    baseURL: 'https://my-api.internal/v1',
    apiKey: process.env.MY_API_KEY ?? '',
  })
  return {}
}
```

### Available hooks

| Hook | Fires when |
|---|---|
| `provider.request.before` | Before the model call — swap provider or model |
| `provider.request.error` | On a retryable error — trigger retry with fallback |
| `session.created` | After a new session is created |
| `session.idle` | After the agent loop exits |
| `session.error` | On an unhandled loop error |
| `session.compacting` | During compaction — inject extra context |
| `tool.execute.before` | Before a tool runs — can mutate args |
| `tool.execute.after` | After a tool returns — receives result |
| `loop.step.before` | Start of each loop iteration |
| `loop.step.after` | End of each loop iteration |

---

## SDK

Use Quark as a library in your own application:

```typescript
import { bootstrap, prompt, resolveProfile, readPromptFile, agentFromProfile } from '@quark/sdk'

// Initialize tools for the profile
await bootstrap({ profileTools: ['read', 'write', 'edit', 'bash'], boundSkills: [] })

// Build the agent config
const profile = resolveProfile('coder')
const { content } = readPromptFile(profile)
const agent = agentFromProfile(profile, content)

// Run a prompt
const result = await prompt({
  parts: [{ type: 'text', text: 'Fix the bug in main.ts' }],
  agent,
})

console.log('Session:', result.sessionId)
```

### Key exports

**Functions**

| Export | Description |
|---|---|
| `bootstrap` | Initialize tools and skills for a session |
| `createSession` / `getSession` | Session CRUD |
| `prompt` | Run the agent loop |
| `cancel` | Cancel an in-flight session |
| `compact` | Manually compact session history |
| `register` / `defineTool` / `listTools` | Tool registry |
| `resolveProfile` / `listProfiles` / `readPromptFile` | Profile system |
| `bus` | Event bus for real-time updates |

**Types:** `ToolDef`, `ToolContext`, `ToolResult`, `Session`, `SessionKind`, `AgentConfig`, `ProfileDef`, `ProfileConfig`, `BusEvents`, `Rule`, `Ruleset`, `Action`

---

## Sessions

Sessions are stored as append-only JSONL event logs:

```
~/.config/quark/session/
  <session-id>/
    session.jsonl     # event log
    meta.json         # derived metadata cache
```

Ephemeral sessions (`--no-store`) live in memory only and are never written to disk.

### Sub-agents

Child agents are linked to a parent session. The parent session ID is passed via `QUARK_SESSION_ID`:

```bash
# Parent spawns a child
quark --sub-agent --profile researcher --prompt "research the auth flow"

# Or explicitly
quark --parent-session <parent-id> --profile researcher --prompt "research the auth flow"
```

---

## Agent Instructions

Quark reads instruction files to customize agent behavior at two levels:

| File | Scope |
|---|---|
| `~/.config/quark/AGENTS.md` | Global — applies to all sessions |
| `./AGENTS.md` | Project-level — applies when running in this directory |

Both files are prepended to the system prompt before the profile's own prompt.

---

## File Layout

```
~/.config/quark/
  config.yaml               global config
  AGENTS.md                 global agent instructions
  profiles/
    coder.md                system prompt for coder profile
    researcher.md
  skills/
    code-review/
      SKILL.md
  tools/
    deploy.ts               external tool
  plugins/
    fallback-model.ts       lifecycle plugin
  session/
    <id>/
      session.jsonl
      meta.json

.quark/                     project-level overrides
  config.yaml
  AGENTS.md
  skills/
    deploy-runbook/
      SKILL.md
```

---

## Build

```bash
bun install
bun run build
```

---

## License

MIT
