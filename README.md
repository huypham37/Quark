# Quark

**An ergonomic, tool-first AI agent for coding _and_ research.**

Quark is a harness — it owns everything around the model: tool execution,
memory, context management, state persistence, and guardrails. The model is a
pluggable component; the harness is the product. The differentiator is a small
set of premade, well-designed, well-tested tools and subagents that give the
best experience for both writing code and doing research.

> **Agent = Model + Harness.** The model provides intelligence. The harness
> makes that intelligence useful.

---

## Highlights

- **The agent loop** — the model reasons, calls a tool, observes the result, and
  repeats until the task is done, with configurable `minSteps` / `maxSteps`
  guardrails.
- **Multi-provider** — Anthropic (Claude), OpenAI (GPT / o-series), GitHub
  Copilot, and any OpenAI-compatible endpoint (Ollama, local models, etc.).
- **Streaming TUI** — a full terminal UI with real-time token streaming, live
  tool progress, model switching, and inline sub-agent observability.
- **Deterministic, named subagents** — subagents are invoked through
  purpose-built tools, each with its own typed contract. No generic `task` /
  `delegate` verb.
- **Per-agent permissions** — `allow / deny / ask` rules evaluated per-agent,
  per-session. Read-only tools default to `allow`; mutating tools default to
  `deny` unless explicitly opted in.
- **Progressive-disclosure skills** — three-level loading (metadata →
  instructions → resources) keeps the context window lean.
- **Session persistence** — per-session JSONL storage with resume, ephemeral
  (`--no-store`) runs, and parent–child session linking for subagents.
- **ACP MCP tools** — ACP clients can attach stdio, Streamable HTTP, or SSE MCP
  servers per session; discovered tools remain session-scoped and use Quark’s
  existing permission flow.

---

## Requirements

- [Bun](https://bun.sh) (runtime + package manager)
- An API key for at least one provider (see [Configuration](#configuration))

## Install

```bash
git clone https://github.com/huypham37/Quark.git
cd Quark
bun install
```

Run the interactive TUI:

```bash
bun run dev
```

Or use the CLI directly:

```bash
bun run cli --help
```

A convenience launcher lives at [`bin/quark`](bin/quark) — add `bin/` to your
`PATH` (or symlink it) to invoke `quark` from anywhere.

---

## Usage

```bash
# Interactive TUI
quark

# One-off prompt with a profile
quark --profile coder --prompt "fix the bug in main.ts"

# Pick a specific model for a single run
quark --model copilot/claude-sonnet-4.5 "use this model for this run"

# Quick question that should never be saved to disk
quark --no-store "what does this regex do?"

# Resume an existing session
quark --session <id>

# Spawn a research sub-agent under a parent session
quark --parent-session <id> --profile researcher --prompt "research the auth flow"
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-p, --profile <name>` | Profile to use (default: from config) |
| `-m, --prompt <text>` | Prompt text (alternative to a positional arg) |
| `-s, --session <id>` | Resume an existing session |
| `--model <id>` | Model for this run, e.g. `copilot/claude-sonnet-4.5` |
| `--parent-session <id>` | Create a child session under this parent |
| `--sub-agent` | Create a child session (reads `QUARK_SESSION_ID` from env) |
| `--no-store` | Run an ephemeral session — never written to disk |
| `--verbose` | Print every tool call + result to stderr |
| `-l, --list-profiles` | List available profiles |
| `-h, --help` | Show help |

---

## Configuration

Config lives at `~/.config/quark/config.yaml`. Missing files and fields fall
back to sensible defaults. Models are always written as `provider/model`.

```yaml
version: 2

models:
  main: openrouter/anthropic/claude-sonnet-4.6
  small: openai/gpt-5-mini
  favorites:
    - openrouter/anthropic/claude-sonnet-4.6
    - openai/gpt-5
    - copilot/claude-sonnet-4.6

max_steps: 100

# Used for /settings and clickable file links. Defaults to $EDITOR, $VISUAL, then nvim.
editor: nvim

branching:
  auto: true
  threshold: 0.90

# Only endpoints Quark does not bundle belong here.
providers:
  quark-go:
    protocol: openai-compatible
    endpoint: https://api.quark-go.example/v1
    credential:
      source: environment
      variable: QUARK_GO_API_KEY
    billing: subscription
```

Standard providers require no `providers:` entry. Authenticate interactively with
`quark auth login openrouter`, or set a user-managed environment variable for
headless use. API-key values are never accepted in V2 configuration.

Some models support an additional reasoning mode. For those models—currently
the GPT-5.6 family—set `thinking_mode: pro` alongside `thinking_effort`. Quark
warns and ignores the setting when the selected model does not support modes.

Older profile configs using `model: { id, thinking: { effort, mode } }` are
still accepted for migration. New and updated profile settings are written in
the flat form shown above.

Per-project overrides go in `.quark/config.yaml` at the repo root.

Set provider API keys through `quark auth login`, or use provider-standard
environment variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
`OPENROUTER_API_KEY`. Quark reads environment variables but never edits shell
startup files.

---

## Profiles

A profile is a baked-in agent identity declared in YAML — `prompt_file`,
`tools[]`, `skills[]`, and an optional `model`. Activate one deterministically
with `--profile <name>`:

```bash
quark --list-profiles
quark --profile researcher --prompt "..."
```

---

## Tools & Subagents

Tools are the product — research-backed and test-backed.

**Built-in tools** are registered by the harness at bootstrap: `read`, `look`,
`skill`, `question`, `find_session`, and `read_session`.

**Profile-declared tools** are loaded by ID from `~/.config/quark/tools/{id}.ts`
when a profile lists them in its `tools[]` array. Reference implementations for
`bash`, `edit`, `glob`, `grep`, `todo`, `websearch`, and `write` live in
[`examples/tools/`](examples/tools) — copy them into `~/.config/quark/tools/`
to enable them.

A **subagent** is an agent (prompt + tools + permissions + model) exposed through
a thin, named tool. It runs in its own isolated session (`kind: "subagent"`,
`parentSessionId` set) so its intermediate reasoning never pollutes the parent's
context — the parent transcript stores only the tool call and the final result.

---

## Architecture

```diagram
╭─────────────────────────────────────────────────╮
│                  TUI / SDK / CLI                  │
├─────────────────────────────────────────────────┤
│        Baked-in Agents (identities, in code)      │
│         prompt + tools[] + skills[] + perms       │
├──────────┬──────────┬───────────┬─────────────────┤
│  Agent   │  Tool    │  Skill    │  Permission     │
│  Loop    │  System  │  System   │  System         │
├──────────┴──────────┴───────────┴─────────────────┤
│              Persistence (JSONL)                   │
│   Session (main | subagent | ephemeral)           │
│        → Message → Part   (parentSessionId)        │
╰─────────────────────────────────────────────────╯
```

See [`docs/data-model.md`](docs/data-model.md) for the persistence schema,
[`docs/acp-integration-guide.md`](docs/acp-integration-guide.md) for the agent
control protocol, and [`specs/`](specs/) for design records.

---

## Using Quark as an SDK

Quark also ships as the `@quark/sdk` package, exposing its session, tool,
permission, and agent primitives:

```ts
import { bootstrap, createSession, prompt } from "@quark/sdk"
```

---

## Development

```bash
bun run dev          # run the TUI from source
bun run cli          # run the CLI from source
bun run typecheck    # type-check the project
bun run build        # bundle to dist/ (tsup + declarations)
bun run docs         # generate API docs with TypeDoc
bun test             # run the test suite
```

> Always run the tests after changing core functionality. Quark's moat is
> test-backed tools — keep it that way.

---

## Status

Quark is early and under active development — some tools listed in the
[CHANGELOG](CHANGELOG.md) are still being implemented or ship as examples. Expect
the surface area to change.

## License

No license has been published yet.
