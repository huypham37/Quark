# ACP Integration Guide — Talking to Quark via the Agent Client Protocol

[The Agent Client Protocol (ACP)](https://agentclientprotocol.com) is an open standard that
decouples coding agents from code editors. **Quark speaks ACP natively** — any
editor, CLI, or application that implements an ACP client can drive Quark
as a subprocess.

This guide covers everything you need to write an ACP client that talks to
Quark. It assumes you are familiar with JSON-RPC 2.0; if not, skim the
[spec](https://www.jsonrpc.org/specification) first — it's short.

---

## 1. Architecture

```diagram
╭──────────╮   spawns   ╭─────────────────╮   NDJSON    ╭──────────╮
│  Editor  │───────────▶│  quark acp -p   │────────────▶│  stdout  │
│ (Client) │◀───────────│  coder           │◀────────────│  stdin   │
╰──────────╯            ╰─────────────────╯             ╰──────────╯
                         Quark (Agent)
```

- **Transport:** JSON-RPC 2.0 over **NDJSON** (newline-delimited JSON) on
  stdin/stdout. Every message is exactly one line of JSON.
- **stderr** is reserved for Quark debug logs — do **not** parse it as
  protocol messages.
- **Agent vs Client:** The *agent* is Quark. The *client* is your editor/IDE.
  Method dispatch is bidirectional — the agent handles client requests,
  and the client handles agent requests (e.g. permission prompts,
  filesystem reads).

---

## 2. Starting Quark in ACP Mode

```bash
quark acp [--profile <name>]
```

| Argument | Effect |
|----------|--------|
| `--profile coder` (default) | Quark's primary coding agent |
| `--profile finder` | Fast code-search sub-agent |
| `--profile researcher` | Deep research agent |
| `--profile oracle` | Reasoning / architecture agent |

The profile controls the system prompt, bound tools, and optional skills.
The editor can switch profiles mid-session with `session/set_mode`.

---

## 3. Protocol Versioning

Quark advertises `protocolVersion: 1` during initialization.
The canonical schema lives at
<https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json>.

---

## 4. Lifecycle — Step by Step

### 4.1 Initialize

The client sends `initialize` first:

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "my-editor",
      "title": "My Editor",
      "version": "1.0.0"
    },
    "clientCapabilities": {
      "fs": { "readTextFile": true, "writeTextFile": false },
      "terminal": true
    }
  }
}
```

Quark responds with its capabilities:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "image": true,
        "embeddedContext": true
      },
      "mcpCapabilities": { "http": true },
      "sessionCapabilities": {
        "resume": {},
        "close": {}
      }
    },
    "agentInfo": {
      "name": "quark",
      "title": "Quark",
      "version": "0.1.0"
    },
    "authMethods": []
  }
}
```

### 4.2 Create a Session

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/absolute/path/to/project",
    "mcpServers": []
  }
}
```

Quark creates the session and returns its id plus available config:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "abc123-def-456",
    "configOptions": [
      { "name": "model", "value": "gpt-5-mini" },
      { "name": "available_models", "value": ["gpt-5-mini", "claude-opus-4-5-20251101"] }
    ],
    "modes": {
      "currentModeId": "coder",
      "availableModes": [
        { "id": "coder", "name": "Coder" },
        { "id": "finder", "name": "Finder" },
        { "id": "oracle", "name": "Oracle" }
      ]
    }
  }
}
```

### 4.3 Send a Prompt (The Core Loop)

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc123-def-456",
    "prompt": [
      { "type": "text", "text": "Refactor the auth module to use async/await" }
    ]
  }
}
```

Quark runs the agent loop (model → tool → model → tool → …) and streams
updates as **notifications** (see §5). When the turn ends, Quark sends the
response:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn"  // or "cancelled", "max_tokens", "refusal"
  }
}
```

**Important:** The prompt handler does **not** block the message loop.
You can send `session/cancel` at any time and Quark will abort the current
turn — the response will arrive with `"stopReason": "cancelled"`.

### 4.4 Cancel a Running Prompt

Send a **notification** (no `id`):

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "abc123-def-456"
  }
}
```

There is no response — the pending `session/prompt` request resolves with
`"stopReason": "cancelled"`.

---

## 5. Streaming: Session Update Notifications

During a prompt turn, Quark pushes real-time updates via
`"method": "session/update"` **notifications**. Each notification has a
`sessionUpdate` discriminator field:

### 5.1 Text Chunks

```jsonc
// agent_message_chunk — model output
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "agent_message_chunk",
    "content": { "type": "text", "text": "I'll start by reading the auth module..." }
  }
}

// agent_thought_chunk — internal reasoning (thinking mode)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "agent_thought_chunk",
    "content": { "type": "text", "text": "Let me analyze the auth flow..." }
  }
}
```

### 5.2 Tool Calls

Tool calls go through a two-phase notification pattern:

```jsonc
// Phase 1: Tool call begins (pending)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "tool_call",
    "toolCallId": "call_1",
    "title": "read",
    "kind": "read",
    "status": "pending"
  }
}

// Phase 2a: Tool is now running
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "tool_call_update",
    "toolCallId": "call_1",
    "status": "in_progress"
  }
}

// Phase 2b: Tool completed (or failed)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "tool_call_update",
    "toolCallId": "call_1",
    "status": "completed",
    "content": [
      { "type": "text", "text": "1: export async function login(...)" }
    ]
  }
}
```

#### Tool kinds

Quark maps its internal tool names to ACP tool kinds:

| Quark Tool | ACP Kind    |
|-----------|-------------|
| `read`    | `"read"`    |
| `write`   | `"edit"`    |
| `edit`    | `"edit"`    |
| `bash`    | `"execute"` |
| `search`  | `"search"`  |
| others    | `"other"`   |

### 5.3 Plan (Execution Progress)

Quark emits a plan notification whenever the tool-call task list changes:

```jsonc
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "plan",
    "entries": [
      { "content": "read auth module", "priority": "high", "status": "completed" },
      { "content": "refactor to async/await", "priority": "high", "status": "in_progress" },
      { "content": "run tests", "priority": "medium", "status": "pending" }
    ]
  }
}
```

### 5.4 Mode & Config Changes

```jsonc
// Mode switch
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "current_mode_update",
    "modeId": "oracle"
  }
}

// Config change (e.g. model switch)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionUpdate": "config_option_update",
    "configOptions": [
      { "name": "model", "value": "claude-opus-4-5-20251101" }
    ]
  }
}
```

---

## 6. Content Blocks (Prompt Input)

Quark accepts these content block types in `session/prompt`:

| Type | Description |
|------|-------------|
| `{ "type": "text", "text": "…" }` | Plain text (Markdown) |
| `{ "type": "image", "data": "base64…", "mimeType": "image/png" }` | Base64-encoded image |
| `{ "type": "resource", "resource": { "uri": "file://…", "text": "…" } }` | Embedded file content |
| `{ "type": "resource_link", "uri": "file://…", "name": "auth.ts" }` | Link to a resource |

Images are passed through to vision-capable models.
`resource` blocks are unwrapped into text (prefixed with the URI).
`resource_link` blocks become Markdown links.

---

## 7. Session Management Methods (Agent → Client)

These are methods the **agent calls on the client** — your editor must
implement them.

### 7.1 `session/request_permission`

Quark asks the editor for permission before executing certain tools:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "session/request_permission",
  "params": {
    "sessionId": "abc123-def-456",
    "toolCall": {
      "toolCallId": "req_1",
      "title": "bash",
      "kind": "execute"
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "allow-always", "name": "Allow always", "kind": "allow_always" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
    ]
  }
}
```

**Your client must respond:**

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "outcome": { "outcome": "selected", "optionId": "allow-once" }
  }
}
```

`outcome` may also be `{ "outcome": "cancelled" }` if the user dismisses the
dialog without choosing.

### 7.2 `fs/read_text_file`

If you declared `"readTextFile": true` in `clientCapabilities`, Quark will
delegate file reads to your editor:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "fs/read_text_file",
  "params": { "sessionId": "…", "path": "/absolute/path/to/file.ts" }
}
```

Respond with:

```jsonc
{ "jsonrpc": "2.0", "id": 11, "result": { "content": "file contents..." } }
```

### 7.3 `fs/write_text_file`

If `"writeTextFile": true`, Quark delegates file writes:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "fs/write_text_file",
  "params": { "sessionId": "…", "path": "/…/file.ts", "content": "…" }
}
```

### 7.4 Terminal Methods

If `"terminal": true` in client capabilities:

| Method | Purpose |
|--------|---------|
| `terminal/create` | Start a shell command |
| `terminal/output` | Read buffered output |
| `terminal/wait_for_exit` | Block until the command exits |
| `terminal/kill` | Send SIGTERM |
| `terminal/release` | Free terminal resources |

---

## 8. Session Configuration Methods (Client → Agent)

### 8.1 Switch Mode (Profile)

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "session/set_mode",
  "params": {
    "sessionId": "abc123-def-456",
    "modeId": "oracle"
  }
}
```

The agent will re-bootstrap tools/skills for the new profile.
A `current_mode_update` notification is fired automatically.

### 8.2 Change Model

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "abc123-def-456",
    "configOptions": [
      { "name": "model", "value": "claude-opus-4-5-20251101" }
    ]
  }
}
```

Use the `available_models` list from `session/new` to discover valid model
identifiers. A `config_option_update` notification is fired automatically.

### 8.3 Load (Resume) an Existing Session

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "session/load",
  "params": {
    "sessionId": "abc123-def-456",
    "cwd": "/path/to/project"
  }
}
```

Quark replays the full conversation history as session update notifications,
then responds with the session's config and modes. This lets editors restore
state on reconnect.

---

## 9. Error Handling

Standard JSON-RPC error codes are used:

| Code | Meaning |
|------|---------|
| `-32700` | Parse error (malformed JSON) |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32002` | Resource not found (e.g. unknown session id) |

Parse errors and invalid requests are non-fatal — Quark logs to stderr and
continues reading.

---

## 10. Full Example — A Minimal TypeScript Client

```typescript
// Spawn Quark, initialize, create a session, send a prompt, stream results.

import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

const child = spawn("quark", ["acp", "--profile", "coder"], {
  stdio: ["pipe", "pipe", "pipe"],
})

const rl = createInterface({ input: child.stdout })
let nextId = 1

function send(msg: Record<string, unknown>): void {
  child.stdin.write(JSON.stringify(msg) + "\n")
}

// Buffer: id → resolve/reject for response matching
const pending = new Map<number, { resolve: Function; reject: Function }>()

rl.on("line", (line: string) => {
  const msg = JSON.parse(line)

  // Route responses to their callers
  if ("id" in msg && !("method" in msg) && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)!
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
    return
  }

  // Handle notification (session updates, plan, etc.)
  if (msg.method === "session/update") {
    const p = msg.params
    switch (p.sessionUpdate) {
      case "agent_message_chunk":
        process.stdout.write(p.content.text)  // stream to terminal
        break
      case "tool_call":
        console.log(`\n🔧 ${p.title} (${p.status})`)
        break
      case "tool_call_update":
        if (p.status === "completed")
          console.log(`   ✅ ${p.toolCallId} done`)
        break
      case "plan":
        console.log(`\n📋 Plan:`, p.entries)
        break
    }
  }

  // Handle agent→client requests (permission, fs, terminal)
  if ("method" in msg && "id" in msg) {
    switch (msg.method) {
      case "session/request_permission":
        // Auto-accept in this minimal client
        send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: "allow-once" } } })
        break
    }
  }
})

child.stderr.on("data", (d: Buffer) => process.stderr.write(d))

// ── Main flow ──────────────────────────────────────────────────────

async function rpc(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ jsonrpc: "2.0", id, method, params })
  })
}

// 1. Initialize
const init = await rpc("initialize", { protocolVersion: 1 }) as any
console.log("Agent:", init.agentInfo.title, "v" + init.agentInfo.version)

// 2. Create session
const sess = await rpc("session/new", { cwd: process.cwd() }) as any
const sessionId = sess.sessionId
console.log("Session:", sessionId)

// 3. Send prompt
const result = await rpc("session/prompt", {
  sessionId,
  prompt: [{ type: "text", text: "List the files in src/" }],
}) as any
console.log("\n--- DONE ---")
console.log("Stop reason:", result.stopReason)

child.stdin.end()
```

---

## 11. Reference — Complete Method Index

### Client → Agent (your editor calls these)

| Method | Description |
|--------|-------------|
| `initialize` | Handshake, exchange capabilities |
| `session/new` | Create a new session |
| `session/load` | Resume an existing session |
| `session/prompt` | Run the agent on a user prompt |
| `session/cancel` | Abort the current prompt (notification) |
| `session/set_mode` | Switch agent profile |
| `session/set_config_option` | Change model or other config |

### Agent → Client (Quark calls these — you must implement)

| Method | Description |
|--------|-------------|
| `session/request_permission` | Ask user to allow/reject a tool execution |
| `fs/read_text_file` | Read a file from the workspace |
| `fs/write_text_file` | Write a file to the workspace |
| `terminal/create` | Execute a shell command |
| `terminal/output` | Read terminal output |
| `terminal/wait_for_exit` | Block until command exits |
| `terminal/kill` | Terminate a command |
| `terminal/release` | Free terminal resources |

### Agent → Client (notifications)

| Method | Session Update Type | Purpose |
|--------|---------------------|---------|
| `session/update` | `agent_message_chunk` | Streaming model output |
| `session/update` | `agent_thought_chunk` | Internal reasoning output |
| `session/update` | `tool_call` | Tool call started |
| `session/update` | `tool_call_update` | Tool call progress/result |
| `session/update` | `plan` | Execution plan entry list |
| `session/update` | `current_mode_update` | Profile/mode changed |
| `session/update` | `config_option_update` | Config changed |

---

## 12. Further Reading

- [ACP Specification](https://agentclientprotocol.com) — official docs, schema, and RFDs
- [ACP TypeScript Library](https://agentclientprotocol.com/libraries/typescript.md)
- [Quark Source — `src/acp/`](../src/acp/) — reference implementation
