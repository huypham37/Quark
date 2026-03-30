# Sub-Agent TUI Rendering Bug

**Status:** Open  
**Severity:** High — breaks sub-agent observability entirely  
**Component:** TUI rendering + Bash tool event forwarding

---

## Symptom

When the LLM spawns a sub-agent via the bash tool (`quark --sub-agent --profile finder ...`), the TUI inconsistently renders the result. Expected: SubAgentView showing profile name ("Finder"), token count, and nested tool calls. Actual: the full bash command is displayed as a regular ToolInvocationBlock.

```
Expected:
  ⠋ Bash
  └─ ⠋ Finder                    12.4k tokens (8%)
     ├── ✓ Read package.json
     └── Streaming...

Actual:
  .: Bash
  └─ quark --sub-agent --profile finder --prompt "..." 2>&1
```

---

## Root Causes

### 1. `2>&1` Redirect Kills Event Forwarding

**The primary cause.** The LLM appends `2>&1` to the bash command, which redirects the child process's stderr to stdout. Since the event-writer (`src/session/event-writer.ts`) writes `QUARK_EVENT:` lines to **stderr**, the redirect merges them into stdout where they are treated as regular output — never reaching the parent's stderr parser in `~/.config/quark/tools/bash.ts`.

**Flow when working (no `2>&1`):**
```
Child stderr → QUARK_EVENT:{...}\n → Parent stderr parser → bus.emit("subagent-*") → TUI state → SubAgentView
```

**Flow when broken (with `2>&1`):**
```
Child stderr → redirected to stdout → treated as output text → no events forwarded → subAgent stays undefined → ToolInvocationBlock rendered
```

**Relevant files:**
- `src/session/event-writer.ts` — writes events to `process.stderr` (lines 25-31)
- `~/.config/quark/tools/bash.ts` — parses stderr line-by-line for `QUARK_EVENT:` prefix (lines 143-162)

**Fix options:**
1. **Strip `2>&1` from commands** in the bash tool before execution when sub-agent is detected
2. **Instruct the LLM** via system prompt to never use `2>&1` with `quark --sub-agent` commands
3. **Use a different IPC channel** (e.g., fd 3, unix socket, or temp file) instead of stderr for event forwarding — eliminates the fragility entirely
4. **Bash tool intercepts and rewrites** the command to remove stderr redirects when `isSubAgentCommand()` returns true

### 2. SolidJS Store Reactivity — Property Must Exist at Creation

**Secondary cause.** Even when events flow correctly, the `<Switch>/<Match>` in `message-item.tsx` may not re-evaluate because SolidJS store proxies **cannot track properties that didn't exist when the object was first inserted into the store**.

When `tool-start` fires, the tool part is created without `subAgent`:
```ts
// src/tui/state.ts — tool-start handler (line 327)
parts.push({
  type: "tool",
  tool: action.tool,
  callId: action.callId,
  status: "pending",
  input: {},
  // subAgent NOT present → proxy never tracks it
})
```

Later, `produce()` sets `parent.subAgent = {...}` — but the proxy doesn't fire reactivity because `subAgent` was never part of the initial shape.

**Fix applied:** Initialize all optional properties as `undefined` so the proxy tracks them:
```ts
parts.push({
  type: "tool",
  tool: action.tool,
  callId: action.callId,
  status: "pending",
  input: {},
  output: undefined,
  error: undefined,
  diff: undefined,
  subAgent: undefined,  // ← proxy now tracks this
})
```

**Relevant files:**
- `src/tui/state.ts` — `tool-start` handler (line 322-336), all `subagent-*` handlers (lines 357-499)
- `src/tui/components/message-item.tsx` — `<Switch>/<Match>` ordering (lines 46-131), sub-agent Match (line 68)

---

## Match Ordering in message-item.tsx

The `<Switch>` in `PartView` evaluates top-down, first truthy match wins:

| # | Condition | Renders |
|---|-----------|---------|
| 1 | `type === "text"` | AssistantMessage |
| 2 | `type === "tool" && status === "running" && tool === "skill"` | ToolInvocationBlock |
| 3 | `type === "tool" && subAgent` (truthy) | **SubAgentView** ← target |
| 4 | `type === "tool" && status === "running" && tool === "bash"` | ToolInvocationBlock (full command) |
| 5 | `type === "tool"` | ToolResultLine |
| 6 | `type === "thinking"` | ThinkingIndicator |

When `subAgent` is undefined (due to cause 1 or 2), Match 3 is falsy → falls through to Match 4 → renders the full command as a regular running bash tool.

---

## Event Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Parent Quark Process                                    │
│                                                         │
│  bash.ts (tool)                                         │
│    spawn("/bin/sh", ["-c", command])                    │
│    │                                                    │
│    ├── stdout → output buffer                           │
│    └── stderr → line parser ──┐                         │
│                               │ QUARK_EVENT:{...}       │
│                               ▼                         │
│         forwardEvent() → bus.emit("subagent-*")         │
│                               │                         │
│         events.ts (wireEvents) → dispatch()             │
│                               │                         │
│         state.ts (produce) → mutate subAgent on part    │
│                               │                         │
│         message-item.tsx → <Switch> re-evaluates        │
│                               │                         │
│         SubAgentView renders profile + tools            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Child Quark Process (--sub-agent)                       │
│                                                         │
│  QUARK_EMIT_EVENTS=1                                    │
│  event-writer.ts → process.stderr.write(QUARK_EVENT:)   │
│                                                         │
│  ⚠ If command has 2>&1, stderr → stdout                │
│    → events lost, parent sees them as plain output      │
└─────────────────────────────────────────────────────────┘
```

---

## Verification

**Debug logs** confirming events flow when `2>&1` is NOT present:
- `/tmp/quark-state-debug.log` — shows `subagent-tool-start`, `subagent-step-finish`, `subagent-text-delta` all finding parent and attaching subAgent state
- `/tmp/quark-bash-debug.log` — shows `Forwarding event:` for each parsed event

**How to reproduce the bug:**
1. Start quark TUI
2. Ask it to "run finder sub-agent to explore the codebase"
3. Observe the LLM generates a bash command ending in `2>&1`
4. TUI shows full command text instead of SubAgentView

---

## Files Involved

| File | Role |
|------|------|
| `src/tui/components/message-item.tsx` | Switch/Match dispatch for tool rendering |
| `src/tui/components/sub-agent-view.tsx` | SubAgentView component (profile, tokens, child tools) |
| `src/tui/state.ts` | Store mutations for subagent-* actions |
| `src/tui/events.ts` | Wires bus events to dispatch calls |
| `src/session/event-writer.ts` | Child process writes events to stderr |
| `~/.config/quark/tools/bash.ts` | Parent-side spawn, stderr parsing, event forwarding |
| `src/session/events.ts` | Event bus type definitions |
