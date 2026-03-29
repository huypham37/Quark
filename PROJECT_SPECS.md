# PROJECT_SPECS — Quark

> Audit-grade specification document for the Quark AI coding agent.
> Generated from deep code exploration of the live codebase.
> Last updated: 2026-03-29

---

## Project Name

**Quark** (package: `@quark/sdk`)

---

## Purpose

Quark is a **programmable AI coding agent harness** built from scratch. It wraps the Agent = Model + Harness paradigm: the model provides intelligence; Quark owns everything else — the agent loop, tool execution, context management, session persistence, permissions, skills, sub-agent spawning, and extensibility via plugins.

Quark is intentionally not a chatbot. It is a loop-driven, profile-shaped agent that operates autonomously over multi-step tasks. Its primary interfaces are a terminal TUI (interactive) and a CLI (non-interactive / programmable). It also ships as an installable SDK (`@quark/sdk`) for embedding in other systems.

The design thesis: **the agent adapts to your system, not the other way around.** Users bring tools that describe their workflow; Quark discovers behavior through those tools.

---

## Target Audience

| Persona | Description |
|---|---|
| **Power developer** | Daily driver for complex coding tasks — file editing, debugging, multi-step refactoring |
| **Platform engineer** | Embeds Quark SDK into CI/CD, automation scripts, or internal tooling |
| **AI tool builder** | Extends Quark via the plugin system, custom tools, and custom profiles |
| **Researchers / polyglot engineers** | Uses multiple profiles (coder, researcher, etc.) for domain-specific agent behaviour |

---

## Core Features

### Agent Loop
- Multi-step agent loop with configurable `max_steps` (default: 100)
- Loop terminates on `stop` finish reason or when all tool calls are resolved
- Abort/cancel support via `AbortController` (Escape key or `cancel()` API)
- Session `QUARK_SESSION_ID` env var propagated to child processes (bash tool sub-agents)

### Profile System
- Profiles declare agent identity: system prompt file, tools[], skills[], optional model override
- Config hierarchy: global (`~/.config/quark/config.yaml`) → project (`.quark/config.yaml`)
- Project-level `profile_overrides` for additive `skills_add` and `tools_add`
- Built-in fallback: `coder` profile (`read`, `write`, `edit`, `bash`, `skill`, `todo`)
- Runtime profile switching via `/profile <name>` TUI command — no session restart

### Tool System
- Universal `ToolDef<T>` interface (id, description, Zod parameters, execute function)
- Tool registry with validation — rejects malformed tools at registration time
- Profile-declared tools only — no global tool pool leaking into agents
- External tools loaded from `~/.config/quark/tools/{id}.ts` at bootstrap
- Built-in tools: `read`, `compact`, `skill`
- Tool permission hooks before execution; tool result forwarded to LLM

### Skill System (3-level progressive disclosure)
- **L1 (Metadata):** Name + description injected into system prompt on profile activation (~100 tokens/skill)
- **L2 (Instructions):** Full SKILL.md body loaded on `skill` tool invocation (<5k tokens)
- **L3 (Resources):** Filesystem scripts/references never loaded into context
- Discovery: `.quark/skills/*/SKILL.md` (project) and `~/.config/quark/skills/*/SKILL.md` (global)
- Project skills override global skills of the same name

### Permission System
- Three actions: `allow` / `deny` / `ask`
- Rule evaluation: last-matching-rule-wins, wildcard pattern matching (`*` and `?`)
- `ask` pauses execution, enqueues a `PendingRequest`, emits `permission-request` on the bus
- TUI responds with `once` (single call) / `always` (session-wide) / `reject` (with optional feedback)
- `CorrectedError` delivers user feedback back to the model; `RejectedError` halts
- `DeniedError` thrown immediately on hard deny rules

### Session Persistence (SQLite)
- Three tables: `session`, `message`, `part`
- Session: id, title (auto-generated), directory, parent_session_id, kind (`main`/`subagent`), timestamps
- Message: id, session_id, role (`user`/`assistant`), model_id, provider_id, finish reason, token usage, timestamps
- Part: id, message_id, session_id, type (`text`/`tool`/`step-start`/`step-finish`/`summary`/`image`/`reasoning`), JSON data blob
- Idempotent migrations run at startup — no migration files, inline `ALTER TABLE` guards

### Context Compaction
- Auto-compaction triggered when estimated tokens ≥ `threshold` × context_window (default 95%)
- Two built-in methods: `general` (default) and `anchored`
- **General method:** strips all tool calls from evicted span, LLM summarizes text-only; creates **new session** seeded with summary + retained N turns
- **Anchored method:** writes a summary anchor back into the same session
- Configurable: `retain_turns` (default 5), `threshold` (default 0.95), `auto` (default true)
- Manual trigger: `/compact` TUI command or `compact` tool call
- Deduplication guard prevents concurrent compaction on same session
- `session.compacting` plugin hook — plugins can inject extra context into summary

### Provider System
- Primary: GitHub Copilot (OpenAI-compatible endpoint at `api.githubcopilot.com`)
- Claude models with thinking: routed to native Anthropic Messages API endpoint on Copilot
- User-defined OpenAI-compatible providers: configured under `providers:` in `config.yaml`
- API key resolution: literal string or `env:VAR_NAME` indirection
- GPT-5+ models automatically routed to Responses API (vs Chat API for earlier models)
- Runtime provider registration via plugin `registerProvider()` — no config file needed
- Model limits fetched from `models.dev/api.json`, cached to disk, refreshed every hour

### Extended Thinking (Reasoning)
- Enabled via Ctrl+T in TUI (toggles 10,000 token thinking budget)
- Routes to Anthropic Messages API for Claude models when enabled
- `reasoning-start` / `reasoning-delta` / `reasoning-end` stream events persisted as `reasoning` parts
- TUI renders thinking text in a collapsible `ThinkingIndicator` component

### Sub-Agent System
- CLI: `quark --sub-agent --profile <name> --prompt "..."` inherits `QUARK_SESSION_ID`
- Parent session auto-becomes parent; child session typed as `kind: "subagent"`
- Sub-agent activity streamed to parent via NDJSON on stderr
- Parent Bash tool parses NDJSON and re-emits on parent event bus
- TUI renders nested sub-agent tool activity in real time (`SubAgentView` component)
- Profile declares `sub_agents: [id1, id2]` — unknown IDs warned and stripped

### Interactive TUI
- Built on **OpenTUI** + **SolidJS** (reactive, terminal-native)
- Full-terminal scrollable message area with sticky-bottom auto-scroll
- Permission prompt overlay (a/o/r keys)
- Slash commands: `/help`, `/new`, `/sessions`, `/compact`, `/clear`, `/model`, `/profile`, `/exit`
- `@file` mention with fuzzy autocomplete — inlines file content as context
- Image paste support (Ctrl+V) — image chips with Tab navigation and Backspace removal
- Session picker and model picker overlays (arrow key navigation)
- Token usage + cost display in footer bar
- Syntax-highlighted diff view for file edits
- Notification toast system (non-blocking, auto-dismiss)
- Undo/redo in input (Ctrl+Z / Ctrl+Shift+Z)
- Up/Down arrow history navigation in chat input (session-scoped history with draft restore) — works like a terminal shell
- Notification panel uses a solid background that fills the full panel and border area for improved readability
- Copy selection on mouse release (Ctrl+Y)
- Terminal background detection for theme adaptation (dark/light)

### Plugin System
- Plugins: `~/.config/quark/plugins/*.ts` — loaded async at bootstrap
- Each plugin returns a partial map of hook name → handler function
- Hooks: `provider.request.before`, `provider.request.error`, `session.created`, `session.idle`, `session.error`, `session.compacting`, `tool.execute.before`, `tool.execute.after`, `loop.step.before`, `loop.step.after`
- `output` object is mutable per hook — plugins can modify provider/model, args, inject context
- Example use: rate-limit fallback (switch provider on 429), custom telemetry, context injection

### Event Bus
- Typed singleton `bus` (Node EventEmitter under the hood, max 100 listeners)
- 30+ event types covering full agent lifecycle: session, loop, tool, permission, compaction, sub-agent
- TUI subscribes to events for real-time rendering; CLI outputs to stdout
- Sub-agent events forwarded from child stderr NDJSON to parent bus

### Retry Logic
- Automatic retry on: HTTP 429, 5xx, network timeouts, overloaded errors
- Exponential backoff with jitter: ~1s, ~2s, ~4s, ~8s … capped at 30s
- Non-retryable: 4xx (except 429), auth errors (401/403), AbortError
- Plugin `provider.request.error` hook can also trigger retry with provider/model override

### Session Title Generation
- Auto-generates session title using `small_model` (default: `gpt-4o-mini`) in background
- Non-blocking — never fails the session if title generation errors

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | [Bun](https://bun.sh) — required (uses `bun:sqlite` native binding) |
| **Language** | TypeScript (strict mode, ESNext, bundler module resolution) |
| **LLM SDK** | [Vercel AI SDK](https://sdk.vercel.ai) v6 (`ai` package) — `streamText`, `generateText`, typed tool definitions |
| **Anthropic Provider** | `@ai-sdk/anthropic` ^3.0.64 |
| **OpenAI Provider** | `@ai-sdk/openai` ^3.0.41 |
| **TUI Framework** | `@opentui/core` + `@opentui/solid` (OpenTUI) ^0.1.86 |
| **UI Reactivity** | `solid-js` ^1.9.11 |
| **Database** | SQLite via `bun:sqlite` + `drizzle-orm` ^0.45.1 (bun-sqlite adapter) |
| **Config parsing** | `yaml` ^2.8.2 |
| **Validation** | `zod` ^4.3.6 |
| **Build** | `tsup` ^8.5.1 (SDK bundle), `tsc` for declaration files |
| **Test framework** | Bun built-in test runner (`bun test`) |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Interface Layer                                   │
│  ┌─────────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │    TUI (OpenTUI) │   │  CLI (quark) │   │  SDK (@quark/sdk)        │  │
│  │  SolidJS + react │   │  parseArgs   │   │  bootstrap/prompt/cancel │  │
│  └────────┬────────┘   └──────┬───────┘   └────────────┬─────────────┘  │
└───────────┼────────────────────┼──────────────────────── ┼ ──────────────┘
            │                    │                          │
┌───────────▼────────────────────▼──────────────────────── ▼ ──────────────┐
│                         Core Agent Layer                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  prompt() → loop() → processStream() → [tool calls] → loop()        │ │
│  │  (src/session/prompt.ts)                                             │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Profile      │  │ Tool         │  │ Skill        │  │ Permission   │  │
│  │ System       │  │ Registry     │  │ System       │  │ System       │  │
│  │ profile.ts   │  │ registry.ts  │  │ skill.ts     │  │ permission.ts│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Compaction   │  │ Plugin       │  │ Provider     │  │ Event Bus    │  │
│  │ compact-     │  │ registry.ts  │  │ provider.ts  │  │ events.ts    │  │
│  │ resolver.ts  │  │ loader.ts    │  │ models.ts    │  │ (TypedBus)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────────────┬───────────────────────────────────────── ┘
                                 │
┌────────────────────────────────▼───────────────────────────────────────── ┐
│                      Persistence Layer                                     │
│  SQLite (quark.db) via bun:sqlite + drizzle-orm                            │
│  Tables: session | message | part                                          │
│  WAL mode, NORMAL sync, 5s busy timeout, foreign keys ON                   │
└─────────────────────────────────────────────────────────────────────────── ┘
```

### Module Map

```
src/
├── index.ts              — Public SDK exports
├── cli.ts                — CLI entry point (parseArgs, launch TUI or headless)
├── bootstrap.ts          — Initialization: DB, tools, compaction methods, plugins
├── agent.ts              — AgentConfig type + agentFromProfile()
│
├── session/
│   ├── prompt.ts         — prompt() + loop() — THE agent loop
│   ├── processor.ts      — processStream() — consumes LLM stream, persists parts
│   ├── session.ts        — createSession, getSession, listSessions, touchSession
│   ├── session.sql.ts    — Drizzle schema (session, message, part tables)
│   ├── message.ts        — saveUserMessage, createAssistantMessage, addPart, toModelMessages
│   ├── system.ts         — buildSystem() — assembles system prompt array
│   ├── compaction.ts     — shouldCompact, estimateTokens, compact (legacy), getTotalTokens
│   ├── compact-resolver.ts — resolve(), method registry, pending/running deduplication
│   ├── events.ts         — TypedBus + BusEvents definitions
│   ├── event-writer.ts   — NDJSON sub-agent event writer (stderr)
│   ├── retry.ts          — isRetryable, retryDelay, sleep
│   ├── title.ts          — generateSessionTitle (background, small_model)
│   └── methods/
│       ├── general.ts    — General compaction (new-session strategy)
│       └── anchored.ts   — Anchored compaction (in-session summary anchor)
│
├── tool/
│   ├── tool.ts           — ToolDef, ToolContext, ToolResult interfaces
│   ├── registry.ts       — register, resolve, list, validateTool
│   ├── loader.ts         — loadProfileTools from ~/.config/quark/tools/
│   ├── read.ts           — Built-in read tool
│   ├── compact.ts        — Built-in compact tool
│   └── skill.ts          — buildSkillTool (dynamic skill loader)
│
├── skill/
│   └── skill.ts          — discoverSkills, profileSkills, loadSkill (SKILL.md parser)
│
├── profile/
│   └── profile.ts        — resolveProfile, readPromptFile, listProfiles, loadProfileConfig
│
├── permission/
│   └── permission.ts     — evaluate, ask, respond, wildcardMatch, Rule/Ruleset/Action
│
├── config/
│   └── config.ts         — loadConfig, QuarkConfig, getModelId, parseModelSpec, setConfigField
│
├── provider/
│   ├── provider.ts       — createCopilotProvider, createOpenAICompatibleProvider, getModel
│   ├── models.ts         — getModelLimit (models.dev), refresh(), disk cache
│   ├── copilot-auth.ts   — loadToken(), GitHub Copilot OAuth token
│   └── copilot-fetch.ts  — createCopilotFetch() — injects auth headers + thinking budget
│
├── plugin/
│   ├── plugin.ts         — PluginFn, PluginHooks, PluginContext types
│   ├── registry.ts       — registerHook, fireHook, clearHooks
│   └── loader.ts         — loadPlugins (scans ~/.config/quark/plugins/)
│
├── notification/
│   └── notification.ts   — info(), warn(), error() — toast notification queue
│
└── tui/
    ├── index.tsx         — TUI entry point (render App, wire handlers)
    ├── state.ts          — createAppState, dispatch, AppState store (SolidJS)
    ├── events.ts         — wireEvents() — maps bus events to state dispatches
    ├── commands.ts       — Slash command definitions + filterCommands
    ├── theme.ts          — Color palette + terminal background adaptation
    ├── diff-utils.ts     — Unified diff parser for inline diff view
    ├── filelist.ts       — getFiles(), fuzzyFilter() for @ mention autocomplete
    ├── clipboard.ts      — readClipboard / writeClipboard (OSC 52 / pbpaste)
    └── components/
        ├── App.tsx           — Root component; keyboard handler; slash/mention state machines
        ├── MessageItem.tsx   — Routes to user/assistant message renderers
        ├── assistant-message.tsx
        ├── user-message.tsx
        ├── tool-invocation.tsx
        ├── tool-result.tsx
        ├── thinking.tsx      — ThinkingIndicator (collapsible reasoning display)
        ├── sub-agent-view.tsx— Nested sub-agent tool activity
        ├── prompt.tsx        — Input textarea + image chips + token bar
        ├── autocomplete.tsx  — Slash/mention/session/model picker overlay
        ├── permission-prompt.tsx
        ├── footer-bar.tsx
        ├── notifications.tsx
        ├── diff-view.tsx
        ├── inline-spinner.tsx
        └── tree-line.tsx
```

---

## Epics

### Epic 1 — Core Agent Loop & Session Engine
**Status:** Complete  
The foundational agent loop, message persistence, and session lifecycle.

- `prompt()` entry point creates/resumes sessions and drives `loop()`
- `loop()` iterates: load messages → build system → resolve tools → stream → check finish → repeat
- `processStream()` handles all AI SDK stream events (text, tool, step, reasoning, error)
- Session CRUD: create, get, touch, setTitle, list (parent-only and all)
- Message/Part persistence with full conversation replay via `toModelMessages()`
- AbortController propagated through entire call chain; `cancel()` API exposed

### Epic 2 — Profile System
**Status:** Complete  
Profile-driven agent identity — every session has exactly one active profile.

- YAML config: global → project hierarchy with merge/override
- `resolveProfile()`: explicit ID → config default → built-in coder fallback
- `readPromptFile()`: YAML frontmatter parsing for `name` and `description`
- Project-level `profile_overrides` for additive skills/tools
- Sub-agent profile validation with warning on unknown IDs
- Runtime cache reset on `/profile` switch

### Epic 3 — Tool System
**Status:** Complete  
External tool loading, validation, and execution with permission gating.

- Universal `ToolDef<T>` interface with Zod parameter schema
- Registry: register (with validation), list, resolve (by ID array)
- Validation rejects tools missing id, description, Zod parameters, or execute function
- External tool loader: `~/.config/quark/tools/{id}.ts` — async import, graceful error notifications
- Built-in tools: `read` (file reader), `compact` (manual compaction trigger), `skill` (L2 skill loader)
- `toAITool()` converts ToolDef → AI SDK tool with full permission/hook wiring

### Epic 4 — Skill System
**Status:** Complete  
Progressive L1/L2/L3 skill disclosure with profile binding.

- SKILL.md discovery in project and global dirs with last-wins override
- `profileSkills()` filters to profile-bound names for L1 injection
- `loadSkill()` for L2 on-demand loading via `skill` tool call
- `buildSkillTool()` wraps discovery + loading as a registered tool
- `buildSkillBlock()` formats L1 metadata into system prompt section

### Epic 5 — Permission System
**Status:** Complete  
Wildcard rule evaluation and async ask/respond lifecycle.

- `wildcardMatch()` with `*`, `?`, optional trailing ` *` support
- `evaluate()`: last-matching-rule-wins across merged rulesets
- `ask()`: enqueues PendingRequest, emits `permission-request` event, returns Promise
- `respond()`: resolves/rejects pending request; `always` creates session-scope rule + auto-resolves matching pending
- `clearSession()`: cleanup on session end
- `disabled()`: identifies tools blanket-denied by `deny` + `*` pattern rules

### Epic 6 — Context Compaction
**Status:** Complete  
Auto and manual context compaction with pluggable methods.

- `shouldCompact()`: chars/4 heuristic vs configured threshold × context window
- `compact-resolver.ts`: deduplication, pending queue, method dispatch
- **General method:** new-session strategy — summary + N retained turns seeded into fresh session
- **Anchored method:** in-session anchor summary (legacy, kept for backwards compat)
- `session.compacting` plugin hook: inject extra context strings into summary
- `/compact` TUI command and `compact` tool both flow through `compact-resolver`

### Epic 7 — Provider & Model System
**Status:** Complete  
Multi-provider routing with Copilot as primary and user-defined providers.

- `createCopilotProvider()`: cached, wraps custom fetch with Copilot auth headers
- `createCopilotAnthropicProvider()`: for Claude + thinking via Anthropic Messages API
- `createOpenAICompatibleProvider()`: for user-defined providers from config
- `shouldUseResponsesApi()`: GPT-5+ (non-mini) routed to Responses API
- `getModelLimit()`: from models.dev cache; used for compaction threshold
- `resolveModel()`: provider.request.before plugin hook fires before model creation

### Epic 8 — Plugin System
**Status:** Complete  
Drop-in TypeScript plugins with typed hook system.

- 10 hook points covering full session/tool/provider/loop lifecycle
- Loader scans `~/.config/quark/plugins/*.ts`, imports async, collects hooks into registry
- `fireHook()` runs all handlers sequentially, returns final mutable output
- `registerProvider()` in PluginContext: runtime provider registration without config file
- Error-isolated: plugin load failures notified but never crash the agent

### Epic 9 — Sub-Agent System
**Status:** Complete  
Hierarchical sessions with real-time TUI observability.

- `--sub-agent` CLI flag: reads `QUARK_SESSION_ID`, creates child session
- `event-writer.ts`: writes structured NDJSON events to stderr during sub-agent run
- Parent Bash tool parses stderr NDJSON, re-emits as `subagent-*` events on parent bus
- TUI `SubAgentView` renders nested tool activity inline under the parent tool call
- `listChildSessions()` for session tree queries

### Epic 10 — Interactive TUI
**Status:** Complete  
Full terminal UI with rich interaction model.

- OpenTUI + SolidJS reactive rendering at 60fps
- Slash command / mention state machines in `App.tsx`
- Session picker, model picker, permission prompt as overlay modes
- Image attachment via clipboard paste (OSC 52 / pbpaste)
- `@file` context injection with fuzzy autocomplete
- Diff view for file edits with syntax highlighting
- Token usage / cost / model display in footer
- Theme system with automatic terminal background detection

### Epic 11 — Retry & Error Recovery
**Status:** Complete  
Resilient handling of provider failures.

- `isRetryable()` classifies HTTP 429, 5xx, network, overload errors
- Exponential backoff with jitter, capped at 30s
- `provider.request.error` plugin hook for custom retry/fallback logic
- In-flight tool parts marked as errored on mid-stream abort

### Epic 12 — SDK & CLI Distribution
**Status:** Complete (not yet published)  
Quark as a publishable, embeddable SDK.

- `tsup` bundle to ESM + CJS with `@quark/sdk` package name
- Full type exports: ToolDef, Session, AgentConfig, ProfileDef, BusEvents, etc.
- CLI entry `quark` binary via `bin.quark`
- `--list-profiles`, `--help`, `--session`, `--parent-session`, `--sub-agent` flags

---

## Out of Scope

The following are explicitly **not built** and not intended to be built unless a new decision is logged:

| Item | Reason |
|---|---|
| GUI / web interface | Quark is a terminal-native tool |
| npm plugin packages | Plugin is file-based only; npm registry packages are a future consideration |
| Plugin dependencies on each other | Plugins are isolated handler functions, not modules with inter-dependencies |
| Plugin config/settings schema | Plugins read from environment or their own files |
| Speculative / future tools | No tools are added for hypothetical future requirements |
| Opinionated workflow enforcement | The harness is generic; workflow is encoded in user tools |
| RAG / vector memory | Not implemented; future capability if needed |
| Planning / task decomposition | The model plans via reasoning; no explicit planner module exists |
| Cross-session memory | Sessions are isolated; compaction summaries carry forward within a single chain |
| User accounts / authentication | Quark runs locally; auth is purely API key / Copilot OAuth |
| Kitchen-sink system prompts | Profiles are deliberately minimal; no global skill dumps |

---

## Open Questions

| # | Question | Owner | Raised |
|---|---|---|---|
| OQ-1 | Should `general` compaction write a `compactedUntilMessageId` anchor into the new session's summary part? Currently it writes summary as a plain user message — no anchor linking back to the source session ID. | — | 2026-03-29 |
| OQ-2 | `ruleset: []` is hardcoded in `toAITool()` — project/profile permission rules from config.yaml are not wired into tool execution. When will config-level rules be plumbed through? | — | 2026-03-29 |
| OQ-3 | `getCopilotThinkingBudget()` returns a module-level singleton. If multiple concurrent sessions use different budgets, there will be a conflict. Should thinking budget be per-session? | — | 2026-03-29 |
| OQ-4 | The `--sub-agent` mode requires `QUARK_SESSION_ID` set in environment. This works when spawned by the Bash tool but is fragile for other callers. Should there be a more robust session chaining API? | — | 2026-03-29 |
| OQ-5 | `sdk` package is named `@quark/sdk` but listed as v0.1.0. Is there a publishing pipeline, versioning strategy, or changelog process? | — | 2026-03-29 |
| OQ-6 | `atom.db` and `quark.db` both exist at the project root — artifact from a naming migration? Only `quark.db` should be the live database. | — | 2026-03-29 |
| OQ-7 | `sdk_guide.md` still uses `@atom/sdk` import names. Should be updated to `@quark/sdk`. | — | 2026-03-29 |
| OQ-8 | `PHILOSOPHY.md` references `Atom` throughout (internal name), while `AGENTS.md` correctly uses `Quark`. Should PHILOSOPHY.md be updated? | — | 2026-03-29 |

---

## Decision Log

| # | Date | Decision | Rationale | Alternatives Considered |
|---|---|---|---|---|
| DL-1 | Early | Use Bun as the runtime | `bun:sqlite` native SQLite binding, fast TypeScript execution, built-in test runner | Node.js (no native SQLite), Deno (ecosystem immaturity) |
| DL-2 | Early | Vercel AI SDK as LLM abstraction | Provider-agnostic, first-class streaming, typed tool schemas, `streamText`/`generateText` symmetry | Raw fetch, LangChain (too opinionated), LlamaIndex |
| DL-3 | Early | SQLite over PostgreSQL / in-memory state | Zero-deployment, local-first, persists across restarts, works offline | Postgres (overkill), in-memory (lost on crash), file-based JSON |
| DL-4 | Early | OpenTUI + SolidJS for TUI | Terminal-native rendering at 60fps, reactive signals, no DOM dependency | Ink (React for terminals, slower), blessed, custom ANSI renderer |
| DL-5 | Early | Profile-driven identity | Noise reduction — agents only carry tools/skills they need; prevents context bloat | Single global config, capability flags, per-request tool selection |
| DL-6 | Milestone | "New-session" compaction strategy (general method) | Old session is archived as history; new session starts clean with summary seed. No risk of corrupting in-progress session state | In-place summary anchor (anchored method, kept as alternative), token pruning |
| DL-7 | Milestone | Plugin system as file drop (`~/.config/quark/plugins/*.ts`) | Zero friction, no npm publish cycle, idiomatic to Bun/TS, mirrors tool loader pattern | npm packages (publishing burden), config-declared plugins (less flexible) |
| DL-8 | Milestone | Sub-agent events via stderr NDJSON | Stdout is the LLM output stream; stderr is available for structured side-channel data; parent Bash tool can parse without blocking stdout | WebSockets (too heavy), shared DB polling (latency), IPC (complex) |
| DL-9 | Milestone | Provider embedded in model string (`provider/model`) | Single string is easy to configure, grep, and pass via CLI; no separate provider flag needed | Separate `provider:` field in config (more config surface), auto-detect by model name |
| DL-10 | Milestone | Idempotent SQL migrations (no migration files) | Simple for a local SQLite database that can be recreated; avoids migration toolchain | Drizzle Kit push (used only in drizzle.config.ts for dev), Flyway/Liquibase (overkill) |
| DL-11 | Milestone | Permission system: last-matching-rule-wins | Intuitive override semantics — more specific rules added later take priority; mirrors firewall rule conventions | First-match-wins (harder to override base rules), explicit priority fields |
| DL-12 | Milestone | `models.dev` for per-model token limits | Avoids hardcoding model limits that change; auto-refreshes hourly; single source of truth | Hardcoded map (stale fast), LLM vendor APIs (rate-limited, complex auth) |
| DL-13 | 2026-03 | Extended thinking via Ctrl+T toggle | User-controlled toggle rather than always-on; `claude-*` models only; budget of 10k tokens | Always-on thinking (expensive), per-message flag, config file toggle |
| DL-14 | 2026-03 | Rename from Atom → Quark | Brand/naming alignment; some residual `Atom` references remain in PHILOSOPHY.md and SDK_GUIDE.md | Keep Atom (conflict with Atom editor), Nucleus, Forge |
