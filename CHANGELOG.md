# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Versioning strategy:** Versions are bumped manually by updating `package.json` and creating an annotated git tag (`git tag -a vX.Y.Z -m "Release vX.Y.Z"`). No automated release scripts — keep it simple.

---

## [Unreleased]

### Added

- HTTP runner API for external orchestrators. `POST /api/runners` mints an isolated execution instance (own event bus, cancellation state, and hooks) bound to a configured agent; `POST /api/runners/:id/session/prompt`, `GET /api/runners/:id/sessions/:sessionId`, `GET …/events`, `POST …/cancel`, and `DELETE /api/runners/:id` drive it.
- Image attachments on prompts: `POST /api/sessions/:id/messages` and the runner prompt route accept `images: [{ mime, data }]` (PNG / JPEG / GIF / WebP), capped at 8 images, 5 MiB decoded each, 10 MiB body.
- Session-discovery API for external processes: with `QUARK_API_PORT` set, the app serves a read-only localhost `GET /api/session/current` reporting the current session id, so an orchestrator can link its tasks to a Quark session.
- Live viewing of someone else's running session: `quark --session <id>` follows an in-flight turn started by another process (REST runner) instead of refusing it.

### Changed

- **Breaking:** the runner prompt route moved from `POST /api/runners/:id/messages` to `POST /api/runners/:id/session/prompt`. The old path now falls through to `404`.
- **Breaking:** runner sessions are no longer in-memory. Every runner shares one disk-backed namespace, `~/.config/quark/session/runners/<sessionId>/`, so history outlives the runner: a new runner (including one minted after a server restart) resumes any session by id. `DELETE /api/runners/:id` and eviction at the 100-runner cap drop only the execution handle — never session files.
- **Breaking:** the CLI/TUI now store sessions in that same shared namespace, so `quark --session <sessionId>` resumes a session created over REST. Sessions created under the old `~/.config/quark/session/<sessionId>/` path are no longer found by the CLI/TUI.
- Runner prompt `sessionId` is restricted to `[A-Za-z0-9_-]+` (the id alphabet the engine generates) so an id can never escape the session directory. Rejected with `400 sessionId must match [A-Za-z0-9_-]+`; other runner session routes answer `400 Invalid session id`.
- Concurrent turns on one session are refused with `409` across **all** runners, since they share a namespace. `events` and `cancel` address whichever runner owns the in-flight turn, regardless of which runner path the caller used.
- Profile model settings now use the flatter `model`, `thinking_effort`, and optional `thinking_mode` fields. The previous nested `model.thinking` form remains readable for migration.
- The exported `ProfileDef` and `AgentConfig` types now represent model and thinking settings as flat fields.

### Fixed

- Canceled turns now finish when the provider stream stalls instead of leaving the session marked running.

### Removed

- **Breaking:** `quark acp` and Quark's Agent Client Protocol server implementation were removed. External editor integrations that depend on ACP must migrate to another supported interface or pin to a prior release.

## [0.1.0] - 2026-04-01

### Added

#### Core Agent
- Agent loop with configurable `minSteps` / `maxSteps` guardrails
- Multi-provider LLM support: Anthropic (Claude) and OpenAI (GPT / o-series)
- Streaming responses with real-time token delivery
- Thinking mode toggle (Anthropic extended thinking via `Ctrl+T`)
- Context-window awareness with nudges at 25% usage intervals
- Sub-agent spawning with parent–child session linking (`--sub-agent` flag)

#### Session & Persistence
- Per-session JSONL storage (replaces earlier SQLite backend)
- Ephemeral sessions (`--no-store`) that are never written to disk
- Session resume by ID (`--session <id>`)
- Message history navigation (up/down) within the TUI

#### Profile System 
- YAML-driven profiles declaring `prompt_file`, `tools[]`, `skills[]`, and optional `model`
- Deterministic profile activation via `--profile <name>`
- Per-project profile overrides via `.quark/config.yaml`

#### Tool System
- Built-in tools: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `todo`, `websearch`, `webfetch`, `skill`
- External/project-local tools in `~/.config/quark/tools/`
- Permission layer: `allow / deny / ask` rules evaluated before each tool call

#### Skill System
- Three-level progressive loading: L1 metadata → L2 instructions → L3 resources
- Skill discovery via isolated sub-agent to avoid context pollution
- Project-local skills (`.quark/skills/`) and global skills (`~/.quark/skills/`)

#### TUI
- Full terminal UI built with OpenTUI (`@opentui/core` + `@opentui/solid`)
- Real-time streaming output with live `Write` tool progress
- Sub-agent observability — child tool calls rendered inline
- Highlight-to-copy clipboard support
- Scrollable session/profile picker dropdowns
- Tab-cycle model switching
- Undo/redo keybindings in the prompt textarea
- Notification panel with solid background
- `/new` command to open a fresh session; `/profile` to switch profiles

#### CLI & SDK
- `quark` CLI with flags: `--profile`, `--session`, `--model`, `--sub-agent`, `--no-store`
- Public SDK exports for embedding the agent loop in other projects
- Plugin system for runtime provider registration

[0.1.0]: https://github.com/your-org/quark/releases/tag/v0.1.0
