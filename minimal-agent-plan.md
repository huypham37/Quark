# Minimal Coding Agent — Build Plan

> Built from scratch. Opencode as reference, not as fork.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Your TUI (later)                  │
│              subscribes to events, calls API         │
├─────────────────────────────────────────────────────┤
│                    Backend API                       │
│         session.create / session.prompt / cancel     │
├──────────┬──────────┬───────────┬───────────────────┤
│  Agent   │  Tool    │  Provider │   Permission      │
│  Loop    │  System  │  (single) │   System          │
├──────────┴──────────┴───────────┴───────────────────┤
│              Persistence (SQLite)                    │
│          Session → Message → Part                    │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1 — Foundation

### 1.1 Storage Layer

SQLite via Drizzle ORM. Three tables.

```
Session
  id          text PK
  title       text
  directory   text
  time_created  integer
  time_updated  integer

Message
  id          text PK
  session_id  text FK → Session
  role        text (user | assistant)
  model_id    text
  provider_id text
  finish      text (stop | tool-calls | length | null)
  cost        real
  tokens_in   integer
  tokens_out  integer
  time_created  integer
  time_completed integer

Part
  id          text PK
  message_id  text FK → Message
  session_id  text FK → Session
  type        text (text | tool | step-start | step-finish | summary)
  data        text (JSON blob — content varies by type)
```

**Part types and their data shapes:**

| type | data |
|------|------|
| `text` | `{ text: string }` |
| `tool` | `{ tool: string, callID: string, status: pending\|running\|completed\|error, input: {}, output?: string, error?: string }` |
| `step-start` | `{}` |
| `step-finish` | `{ reason: string, tokens: {}, cost: number }` |
| `summary` | `{ text: string }` (from compaction) |

**Reference:** `opencode/packages/opencode/src/session/session.sql.ts`

### 1.2 Tool Contract

The universal interface every tool implements.

```ts
interface ToolContext {
  sessionID: string
  messageID: string
  abort: AbortSignal
  messages: Message[]  // full history for context-aware tools
  ask(permission: string, pattern: string): Promise<void>  // throws if denied
}

interface ToolResult {
  title: string
  output: string       // returned to LLM as tool result
  metadata: Record<string, any>
}

interface ToolDef {
  id: string
  description: string
  parameters: ZodSchema
  execute(args: any, ctx: ToolContext): Promise<ToolResult>
}
```

**Reference:** `opencode/packages/opencode/src/tool/tool.ts` (Tool.define, Tool.Info, Tool.Context)

### 1.3 Permission System

Simple ruleset evaluated before each tool execution.

```ts
type Rule = {
  permission: string   // tool id or category
  pattern: string      // glob pattern for the argument (e.g. file path)
  action: 'allow' | 'deny' | 'ask'
}

type Ruleset = Rule[]

// Evaluate: find first matching rule, default to 'ask'
function evaluate(tool: string, pattern: string, rules: Ruleset): 'allow' | 'deny' | 'ask'

// Ask: if evaluate returns 'ask', emit event to TUI, wait for user response
// If evaluate returns 'deny', throw RejectedError
// If evaluate returns 'allow', proceed silently
```

**Reference:** `opencode/packages/opencode/src/permission/next.ts`

---

## Phase 2 — Core Tools

### 2.1 read

Read files and directories with line ranges.

- Params: `{ path: string, offset?: number, limit?: number }`
- Handles: files (with line numbers), directories (entry listing), images (base64), binary detection
- Output: line-numbered content wrapped in `<path>`, `<content>` tags
- Permission: `read` on file path

**Reference:** `opencode/packages/opencode/src/tool/read.ts`

### 2.2 write

Create new files.

- Params: `{ path: string, content: string }`
- Creates parent directories if needed
- Permission: `write` on file path

**Reference:** `opencode/packages/opencode/src/tool/write.ts`

### 2.3 edit

Search/replace in existing files.

- Params: `{ path: string, old: string, new: string }`
- Finds exact match of `old` in file, replaces with `new`
- Fails if `old` not found or matches multiple locations
- Permission: `edit` on file path

**Reference:** `opencode/packages/opencode/src/tool/edit.ts`

### 2.4 bash

Execute shell commands.

- Params: `{ command: string, timeout?: number }`
- Runs in PTY for proper output handling
- Respects abort signal, kills process on cancel
- Output truncation for large outputs
- Permission: `bash` on command string

**Reference:** `opencode/packages/opencode/src/tool/bash.ts`

### 2.5 skill

Load SKILL.md instruction sets into conversation context.

- Params: `{ name: string }`
- Searches skill directories: `.agent/skills/*/SKILL.md`, `~/.agent/skills/*/SKILL.md`
- Parses frontmatter (name, description) + markdown body
- Returns content wrapped in `<skill_content>` tags
- Lists available skills in tool description so LLM knows what's available
- Permission: `skill` on skill name

**Reference:** `opencode/packages/opencode/src/tool/skill.ts`, `opencode/packages/opencode/src/skill/skill.ts`

### 2.6 todo

Simplified task tracking — append to a markdown file.

- Params: `{ action: 'add' | 'complete' | 'list', task?: string }`
- Reads/writes `.agent/todo.md` in worktree
- Format: `- [ ] task` / `- [x] task`
- Permission: `todo` on action

**Reference:** `opencode/packages/opencode/src/tool/todo.ts` (simplify heavily — just md file ops)

---

## Phase 3 — Agent Loop

### 3.1 System Prompt

Assembled before each LLM call.

```ts
function buildSystem(agent: AgentConfig): string[] {
  return [
    agent.prompt,          // agent-specific instructions
    environmentBlock(),    // cwd, OS, date, platform
  ]
}

function environmentBlock(): string {
  return [
    `Working directory: ${cwd}`,
    `OS: ${os.platform()} (${os.release()}) on ${os.arch()}`,
    `Today's date: ${new Date().toDateString()}`,
  ].join('\n')
}
```

**Reference:** `opencode/packages/opencode/src/session/system.ts`

### 3.2 Message Conversion

Convert DB records to LLM wire format each loop iteration.

```
DB: Message + Part[]  →  AI SDK: ModelMessage[]

User message + TextParts     →  { role: 'user', content: 'text' }
Assistant msg + TextParts    →  { role: 'assistant', content: 'text' }
Assistant msg + ToolParts    →  { role: 'assistant', content: [tool-call] }
                                + { role: 'tool', content: [tool-result] }
Summary parts                →  { role: 'assistant', content: 'summary text' }
```

**Reference:** `opencode/packages/opencode/src/session/message-v2.ts` (toModelMessages)

### 3.3 LLM Call

Single provider, single function.

```ts
import { streamText } from 'ai'

function callLLM(input: {
  model: LanguageModel
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, Tool>
  abort: AbortSignal
}) {
  return streamText({
    model: input.model,
    messages: [
      ...input.system.map(s => ({ role: 'system', content: s })),
      ...input.messages,
    ],
    tools: input.tools,
    toolChoice: 'auto',
    abortSignal: input.abort,
    temperature: 0,
    maxRetries: 0,
  })
}
```

**Reference:** `opencode/packages/opencode/src/session/llm.ts`

### 3.4 Stream Processor

Consume stream events, persist parts to DB, emit events for TUI.

```
for await (const event of stream.fullStream):
  text-delta     → accumulate text, save TextPart, emit 'text-delta' event
  tool-call      → check permission, execute tool, save ToolPart
  tool-result    → update ToolPart to completed
  tool-error     → update ToolPart to error
  finish-step    → save StepFinishPart with tokens/cost
  error          → classify: retryable? overflow? fatal?
```

**Reference:** `opencode/packages/opencode/src/session/processor.ts`

### 3.5 The Loop

The actual agent loop. This is the heart.

```ts
async function loop(sessionID: string, abort: AbortSignal) {
  let step = 0
  while (true) {
    if (abort.aborted) break

    // 1. Load messages from DB
    const messages = await loadMessages(sessionID)
    const lastUser = findLastUser(messages)

    // 2. Check if already finished
    const lastAssistant = findLastAssistant(messages)
    if (lastAssistant?.finish === 'stop') break

    // 3. Step limit
    step++
    if (step > agent.maxSteps) break

    // 4. Create empty assistant message in DB
    const assistantMsg = await createAssistantMessage(sessionID)

    // 5. Resolve tools + wrap in AI SDK format
    const tools = resolveTools(agent)

    // 6. Build system prompt
    const system = buildSystem(agent)

    // 7. Convert history to LLM format
    const modelMessages = toModelMessages(messages)

    // 8. Call LLM + process stream
    const result = await processStream({
      model, system, messages: modelMessages,
      tools, abort, assistantMsg
    })

    // 9. Decide next action
    if (result === 'stop') break
    if (result === 'compact') {
      await compact(sessionID)
      continue
    }
    // result === 'continue' → loop again (LLM made tool calls)
    continue
  }
  return loadLastAssistant(sessionID)
}
```

**Reference:** `opencode/packages/opencode/src/session/prompt.ts` (loop function, lines 274-726)

### 3.6 Entry Point

```ts
async function prompt(input: {
  sessionID: string
  parts: { type: 'text', text: string }[]
  model?: { provider: string, model: string }
}) {
  // 1. Save user message + parts to DB
  await saveUserMessage(input)

  // 2. Enter loop
  return loop(input.sessionID, new AbortController().signal)
}
```

**Reference:** `opencode/packages/opencode/src/session/prompt.ts` (prompt function, lines 158-185)

---

## Phase 4 — Resilience

### 4.1 Retry

Exponential backoff on retryable errors (429, 5xx, timeouts).

```ts
function retryable(error): boolean  // classify the error
function delay(attempt): number     // 1s, 2s, 4s, 8s... with jitter
async function sleep(ms, abort)     // respects abort signal
```

**Reference:** `opencode/packages/opencode/src/session/retry.ts`

### 4.2 Compaction

When token usage approaches model context window:

1. Take all messages except last N
2. Send to LLM: "summarize what happened"
3. Replace old messages with a single summary Part
4. Continue the loop with reduced context

```ts
async function compact(sessionID: string) {
  const messages = await loadMessages(sessionID)
  const toSummarize = messages.slice(0, -KEEP_RECENT)
  const summary = await callLLM({
    system: ['Summarize this conversation concisely'],
    messages: toModelMessages(toSummarize),
    tools: {},  // no tools for compaction
  })
  await saveSummaryPart(sessionID, summary)
  await clearOldParts(toSummarize)
}
```

**Reference:** `opencode/packages/opencode/src/session/compaction.ts`

### 4.3 Abort

AbortController threaded through everything.

- `prompt()` creates the controller
- `loop()` checks `abort.aborted` each iteration
- `streamText()` receives `abortSignal`
- Tool `execute()` receives `abort` in context
- `cancel(sessionID)` calls `controller.abort()`

**Reference:** `opencode/packages/opencode/src/session/prompt.ts` (start/cancel functions)

---

## Phase 5 — Future Extensions (parked)

Tools and features to add later when needed. Not in v1.

| Extension | What it does | Reference |
|-----------|-------------|-----------|
| `task` tool | Spawn sub-agents in child sessions | `tool/task.ts` |
| `grep` tool | Ripgrep-based regex search | `tool/grep.ts` |
| `glob` tool | Fast file pattern matching | `tool/glob.ts` |
| `webfetch` tool | Fetch and read web pages | `tool/webfetch.ts` |
| `websearch` tool | Web search via API | `tool/websearch.ts` |
| `codesearch` tool | Semantic code search | `tool/codesearch.ts` |
| `question` tool | Ask user clarifying questions | `tool/question.ts` |
| `batch` tool | Execute multiple tools in parallel | `tool/batch.ts` |
| `lsp` tool | Language server protocol operations | `tool/lsp.ts` |
| `apply_patch` tool | Apply unified diffs | `tool/apply_patch.ts` |
| Multi-provider | Support multiple LLM providers | `provider/provider.ts` |
| Plugin system | Extensible hooks for third-party code | `plugin/` |
| MCP | Model Context Protocol server integration | `mcp/` |
| Snapshots | Git-based file change tracking | `snapshot/` |
| Token/cost tracking | Detailed billing per session | `session/index.ts` (getUsage) |
| Title generation | Auto-name sessions from first message | `session/prompt.ts` (ensureTitle) |
| Doom loop detection | Detect repeated identical tool calls | `session/processor.ts` |
| Custom tools | Load user-defined tools from `.agent/tool/*.ts` | `tool/registry.ts` |

---

## Dependency Stack

```
bun              — runtime
ai               — Vercel AI SDK (streamText, tool, ModelMessage)
@ai-sdk/openai   — single provider to start (swap later)
drizzle-orm      — SQLite ORM
zod              — tool parameter schemas
```

---

## File Structure (target)

```
src/
  index.ts              — entry point, exports public API
  agent.ts              — agent config type + defaults
  session/
    session.ts          — create, get, touch
    session.sql.ts      — drizzle schema (3 tables)
    message.ts          — save, load, convert to ModelMessages
    prompt.ts           — prompt() + loop() — THE core
    processor.ts        — stream event handler
    compaction.ts       — context summarization
    system.ts           — system prompt builder
    retry.ts            — exponential backoff
  tool/
    tool.ts             — ToolDef interface + define()
    registry.ts         — list of available tools
    read.ts
    write.ts
    edit.ts
    bash.ts
    skill.ts
    todo.ts
  skill/
    skill.ts            — discover + parse SKILL.md files
  permission/
    permission.ts       — evaluate rules, ask user
  provider/
    provider.ts         — single provider setup
  storage/
    db.ts               — SQLite connection + migrations
```

---

## Build Order

1. `storage/db.ts` + `session/session.sql.ts` — get SQLite working
2. `tool/tool.ts` — define the tool contract
3. `tool/read.ts` + `tool/bash.ts` — minimum viable tools
4. `provider/provider.ts` — connect to one LLM
5. `session/message.ts` — save/load/convert messages
6. `session/system.ts` — build system prompt
7. `session/processor.ts` — stream event handler
8. `session/prompt.ts` — the loop. **Now you have a working agent.**
9. `permission/permission.ts` — add permission checks
10. `tool/write.ts` + `tool/edit.ts` — complete file tools
11. `skill/skill.ts` + `tool/skill.ts` — skill loading
12. `tool/todo.ts` — simple md-based todo
13. `session/retry.ts` — retry logic
14. `session/compaction.ts` — context compaction
15. Wire up abort/cancel
16. Build your TUI on top
