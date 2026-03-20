Handoff Summary — Atom repository

Goal

Provide a handoff so another engineer/agent can continue exploring, developing, and testing the Atom codebase. The immediate objectives are:
- Capture what we've done so far.
- Explain the MANUAL_TEST_PLAN and how it maps to code and scripts.
- List what remains to be done and where to look next so continuation is efficient.

Authoritative test plan

MANUAL_TEST_PLAN.md in the repo root is the authoritative manual/test specification. It lists environment expectations, authentication, exact CLI scripts to run, and 16 manual + automated tests (unit, type-check, Copilot login, E2E scripts, TUI demos, event bus tests, DB persistence, reducer sanity).

Important commands (run locally)

- bun test
- bunx tsc --noEmit
- bun scripts/copilot-login.ts         # performs device login, writes ~/.config/atom/copilot-token.json
- bun scripts/e2e.ts "<prompt>" [--model ...]
- bun scripts/tui-demo.tsx
- bun src/tui/index.tsx

Copilot token

- Expected path: ~/.config/atom/copilot-token.json
- Provider implementation reads this file on each request (provider.getToken re-reads the token file per request). That makes login and token refresh local-file driven during tests.

What we've discovered so far (high level)

- MANUAL_TEST_PLAN.md documents test expectations, troubleshooting, and exact CLI scripts/flags to run. It also documents event ordering and TUI tests that rely on the event bus.

- Core architecture and runtime flow (high-level):
  - Agent configuration: src/agent.ts defines AgentConfig and defaultAgent (default tools: ["read","write","edit","bash","skill","todo"], maxSteps, contextLimitTokens).
  - Bootstrap: src/bootstrap.ts initializes the DB and registers tool implementations with the tool registry.
  - Public API: src/index.ts exports bootstrap, session creation/getting, prompt/cancel, compaction helpers, tool registry APIs, event bus, and permission API.
  - Session lifecycle & agent loop: src/session/prompt.ts is the main prompt entrypoint and loop controller. It saves incoming user messages, emits event-bus events ("user-message", "loop-start", "assistant-message-start", etc), builds system + model messages, converts ToolDef -> ai.tool wrappers (zod -> JSON Schema), resolves Copilot provider and token, calls processStream to handle streaming responses/partial deltas/tool invocation orchestration, and triggers compaction when appropriate.
  - Event-driven design: session loop emits granular events (text deltas, tool start/finish, loop start/end) consumed by TUI, scripts, and tests.
  - Permissions: permission subsystem is invoked during tool execution via askPermission; ruleset loading is TODO and currently incomplete.
  - Storage: DB is SQLite via Drizzle. bootstrap ensures tables exist. There's an example atom.db in the repo root.

What was read & summarized

- src/agent.ts — AgentConfig and defaultAgent (tools and limits).
- src/bootstrap.ts — DB initialization flow and tool registration.
- src/index.ts — public API surface (bootstrap, sessions, prompt/cancel, compaction, tool registry, bus, permission APIs).
- src/session/session.ts — session CRUD (create/get/touch/setTitle/list) using Drizzle and UUID generation.
- src/session/prompt.ts — main prompt() entrypoint and loop orchestration; conversion of ToolDefs to model tools; model resolution via Copilot provider; events emission; compaction trigger points.
- src/tool/registry.ts — tool registry behavior (register/get/list/resolve).

Work in progress / not yet completed (recommended reading order)

High priority files to inspect next:
- src/session/message.ts         # message parts and persistence
- src/session/processor.ts       # processStream implementation: streaming handling & tool orchestration
- src/session/events.ts          # event bus/event contracts
- src/session/compaction.ts      # compaction heuristics and triggers
- src/session/system.ts          # system prompt construction
- src/session/title.ts           # title generation
- src/session/retry.ts           # retry logic
- src/session/session.sql.ts     # DB schema and Drizzle maps

Tools & provider:
- src/tool/tool.ts and src/tool/* (read, write, edit, bash, skill, todo) — actual tool behavior, I/O, permission requests.
- src/provider/* (createCopilotProvider, copilot-auth, loadToken, model mapping) — network behavior and token handling.

Permissions and storage:
- src/permission/* — permission evaluation and pending requests API.
- src/storage/db.ts and migrations — DB file paths and initialization logic.

TUI & scripts:
- src/tui/* and scripts/tui-demo.tsx — TUI renderer and reducer used by tests.
- scripts/e2e.ts — E2E CLI script used in tests.

Tests and type-checking

- Tests and tsc have not been executed in this session. Immediate recommended verification steps for the next agent:
  1) Run bunx tsc --noEmit and capture type errors.
  2) Run bun test and inspect failing tests; fix or document blocking issues.

Known/important gaps and TODOs

- The permission ruleset loading behavior is marked TODO; inspect src/permission for intended ruleset flow.
- Several session internals remain unread (listed above). These implement streaming persistence, part handling, and tool orchestration and are high value to understand.
- Tool implementations are unread; need to confirm their permission usage and side effects.
- Provider/auth internals have not been reviewed; confirm network flows and token refresh handling.
- TUI and reducer code not inspected in detail; tests rely on event ordering and reducer behavior.

Immediate next actions (recommended priority)

1. Run the baseline commands and capture the output:
   - bunx tsc --noEmit
   - bun test

2. Verify Copilot auth flows (if running live provider tests):
   - bun scripts/copilot-login.ts — produce ~/.config/atom/copilot-token.json
   - Confirm provider.getToken reads that file each request.

3. Read session internals in this order: message.ts, processor.ts, events.ts, compaction.ts, system.ts, title.ts, retry.ts, session.sql.ts.

4. Inspect tool implementations (src/tool/*) to understand I/O, permission checks, and how tools are wrapped into model tools.

5. Inspect provider & auth (src/provider/*) for token handling and model selection.

6. Run live E2E or TUI demo when token present:
   - bun scripts/e2e.ts "What is 2 + 2?"
   - bun scripts/tui-demo.tsx or bun src/tui/index.tsx

Notes for the next agent

- MANUAL_TEST_PLAN.md is the authoritative manual and should be followed for tests and CLI usage.
- The Copilot token file location is important: ~/.config/atom/copilot-token.json. The provider reads this file per request.
- The session loop is event-driven and emits many granular events; tests/TUI rely on strict ordering — keep that in mind when modifying event emission.

If you'd like me to continue now, I can:
- Run bunx tsc --noEmit and bun test and report results.
- Read and summarize src/session/message.ts next (recommended).
- Create or edit files if you provide a target path and desired content/patch.

Which should I do next?