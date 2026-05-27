# Chapter 2: The Agent Core

Before profiles, before the TUI, before skills and permissions — there was just the loop. A coding agent, at its absolute minimum, needs four things: **tools** to act on the world, **memory** to remember what happened, a **brain** to reason about what to do next, and a **loop** to tie them together. Everything else Quark does is layered on top of these four primitives. So that’s where we start.

## 2.1 Problem Breakdown

If you strip away every feature and look at an agent as a pure function, it has this signature:

```
task → output
```

The user gives you a task. You produce an output. But between input and output, the agent needs to:

1. **Act** — read files, write code, run commands, search the web. Without tools, the LLM is just a chatbot.
2. **Remember** — track the conversation history so each turn builds on the last. Without memory, the agent has amnesia.
3. **Think** — send the context to an LLM and get back reasoning and instructions. Without a brain, there’s no intelligence.
4. **Iterate** — the LLM’s first response often says “I need to look at file X” or “run command Y.” The agent must execute those tool calls, feed the results back, and ask again. Without a loop, it stops after one response.

These four pieces form a closed cycle:

```diagram
╭──────────╮    ╭──────────╮    ╭──────────╮
│  Memory  │───▶│  Brain   │───▶│  Tools   │
╰──────────╯    ╰──────────╯    ╰─────┬────╯
      ▲                                │
      │                                │
      │         ╭──────────╮           │
      ╰─────────│   Loop   │◀──────────╯
                ╰──────────╯
```

- Memory loads the conversation history
- Brain processes it through the LLM
- Tools execute whatever the LLM requested
- Loop feeds results back into memory and starts again

Let’s build each piece.

## 2.2 Tools: The Universal Contract

Every tool in Quark conforms to a single interface — [`ToolDef`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/tool/tool.ts#L73-L86). It’s deliberately minimal:

```typescript
interface ToolDef<T extends z.ZodType = z.ZodType> {
  id: string                              // unique identifier, e.g. "read", "bash"
  description: string                     // sent to the LLM so it knows what the tool does
  parameters: T                           // Zod schema — validates input before execution
  execute(args: z.infer<T>, ctx: ToolContext): Promise<ToolResult>
}
```

Four fields. That’s it. The `description` is what the LLM sees — it’s how the model decides which tool to call and which arguments to pass. The `parameters` Zod schema does double duty: it generates the JSON Schema the LLM uses for structured tool calls, and it validates the arguments at runtime before they reach `execute`.

The `execute` function receives parsed arguments and a `ToolContext` that carries the `sessionId`, `messageId`, `callId`, an `AbortSignal` for cancellation, and an `ask()` method (for future permission checks). It returns a `ToolResult` — a structured object with a human-readable `title`, the `output` (plain text or multi-modal content parts), and arbitrary `metadata` for TUI rendering.

Take the [`read` tool](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/tool/read.ts) as an example — it’s one of the simplest:

```typescript
export const readTool = defineTool({
  id: "read",
  description: "Read a file or directory. Returns line-numbered content...",
  parameters: z.object({
    path: z.string().describe("Absolute or relative file/directory path"),
    offset: z.number().optional().describe("Starting line number"),
    limit: z.number().optional().describe("Maximum number of lines"),
  }),
  async execute(args, _ctx) {
    const filePath = path.resolve(args.path)
    if (!fs.existsSync(filePath)) {
      return { title: `File not found`, output: `Error: ${filePath} does not exist`, ... }
    }
    // ... read and return content
  },
})
```

There’s no framework, no base class, no inheritance. Just a plain object satisfying the interface. The `defineTool` function is an identity helper — it exists purely for TypeScript type inference so the Zod schema’s output type flows into `execute`’s `args` parameter automatically.

### The Registry

Tools register themselves into a global [`Map<string, ToolDef>`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/tool/registry.ts#L9) at import time. Registration runs validation — checking that `id` is a non-empty string, `description` is present, `parameters` is a real Zod schema (Quark checks for `_def`, Zod’s internal marker), and `execute` is a function. Invalid tools are rejected immediately, not silently at runtime.

```typescript
const registry = new Map<string, ToolDef>()

function register(tool: ToolDef): { ok: true } | { ok: false; error: ToolValidationError } {
  // validate tool shape...
  registry.set(tool.id, tool)
  return { ok: true }
}
```

When the agent loop needs tools for a given profile, it calls [`resolveToolSet()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/tool/ai-adapter.ts#L16-L35). This takes the profile’s list of tool IDs, resolves them from the registry, wraps each one in an AI SDK `tool()` wrapper that handles JSON Schema generation, permission checks, Zod validation, and abort signal racing, and returns a `ToolSet` — the shape the AI SDK’s `streamText()` expects. The profile declares `["read", "write", "edit", "bash"]` and the adapter does the rest. The LLM never sees a tool description for a tool it can’t use.

## 2.3 Memory: Sessions, Messages, Parts

Quark’s memory model is a three-level hierarchy: **Session → Message → Part**.

### Session

A [`Session`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/session.ts#L28-L51) is a conversation container — it has an `id` (nanoid), a `title` (auto-generated from the first message), the `directory` where work happened, and metadata like `timeCreated` and `timeUpdated`. Sessions come in three kinds: `main` (top-level), `subagent` (spawned by another agent), and `ephemeral` (in-memory only, never written to disk).

### Messages

Each user input and each LLM response is a [`MessageRow`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/message.ts#L63-L75): it has a `role` (`"user"` or `"assistant"`), a `modelId`, optional `finish` reason (`"stop"`, `"tool-calls"`, `"length"`), and token/cost accounting.

### Parts: The Real Unit of History

Messages are coarse. The real granularity lives in **parts** — the individual content chunks that make up a message. And the reason Quark models things this way isn’t arbitrary: it falls directly out of the AI SDK.

Quark’s first-class interface is the TUI, not the CLI. The TUI needs to render streaming content in real time — each token as it arrives, each tool call as it’s invoked, each tool result as it completes. You can’t wait for the full assistant message to finish before showing anything. The user needs to see what’s happening *as it happens*.

The AI SDK’s `streamText()` emits a [`fullStream`](https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text#fullstream) — an async iterable of fine-grained events. These events are already structured as discrete chunks:

| AI SDK Event | What It Represents | Quark Maps To |
|---|---|---|
| `text-start` | A new text block is beginning | `TextPart` created, `text-start` bus event |
| `text-delta` | A token of text arrived | Append to `TextPart`, `text-delta` bus event |
| `text-end` | Text block complete | Finalize `TextPart`, `text-end` bus event |
| `tool-input-start` | LLM is about to call a tool | `ToolPart` created (status: `pending`) |
| `tool-call` | Full tool arguments received | `ToolPart` updated (status: `awaiting_approval`) |
| `tool-result` | Tool executed successfully | `ToolPart` updated (status: `completed`, output set) |
| `tool-error` | Tool execution failed | `ToolPart` updated (status: `error`, error set) |
| `start-step` | A new reasoning step | `StepStartPart` persisted |
| `finish-step` | Step complete, tokens counted | `StepFinishPart` persisted |
| `reasoning-start/delta/end` | Extended thinking content | `ReasoningPart` streamed + persisted |

Rather than inventing a different abstraction and then translating, Quark mirrors the SDK’s event model directly. [`processStream()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/processor.ts#L90-L228) is essentially a big `switch` over `event.type`. Each event becomes a `Part` persisted to the JSONL file, and each event fires a corresponding bus event that the TUI subscribes to:

```typescript
for await (const event of result.fullStream) {
  switch (event.type) {
    case "text-start": {
      const partId = addPart({ messageId, sessionId, type: "text", data: { text: "" } })
      bus.emit("text-start", { sessionId, messageId, partId })
      break
    }
    case "text-delta": {
      currentText.data.text += event.text
      bus.emit("text-delta", { sessionId, messageId, partId, delta: event.text, text: currentText.data.text })
      break
    }
    case "tool-call": {
      match.data.status = "awaiting_approval"
      match.data.input = event.input
      updatePart(match.partId, match.data, sid, mid, "tool")
      bus.emit("tool-input", { sessionId, messageId, partId, tool: event.toolName, input: match.data.input })
      break
    }
    // ... every other event type
  }
}
```

This design has a nice property: the event stream is the same shape whether you’re watching it live in the TUI or replaying a session from disk. The JSONL file is a serialized `fullStream` — replay it, and the TUI renders identically. There’s no separate “live” and “history” code path.

This granularity also means the TUI can render incrementally — showing each text token as it arrives, displaying tool calls as they execute, updating status from `pending` → `awaiting_approval` → `running` → `completed`. Nothing waits for the full message to finish.

### Storage: Append-Only JSONL

All of this is backed by [JSONL files](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/storage/session-jsonl.ts) — one per session, stored at `~/.config/quark/session/<id>/events.jsonl`. Every message, every part, every status update is appended as a newline-delimited JSON object. This is event sourcing in its simplest form: to replay a session, Quark reads the file from top to bottom and reconstructs the current state.

```jsonl
{"type":"message","id":"msg_01","role":"user","timeCreated":1716000000000}
{"type":"part","id":"prt_01","messageId":"msg_01","kind":"text","data":{"text":"Fix the bug in main.ts"}}
{"type":"message","id":"msg_02","role":"assistant","modelId":"copilot/gpt-4o","timeCreated":1716000001000}
{"type":"part","id":"prt_02","messageId":"msg_02","kind":"text","data":{"text":"Let me read the file first."}}
{"type":"part","id":"prt_03","messageId":"msg_02","kind":"tool","data":{"tool":"read","callId":"call_01","status":"completed","input":{"path":"main.ts"},"output":"..."}}
```

No migrations, no schema changes, no database. When `loadMessages()` is called, [`replaySessionFile()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/storage/session-jsonl.ts) replays the file. When a part is updated (e.g., a tool status changes from `running` to `completed`), a new event for the same `partId` is appended — later events overwrite earlier ones during replay. This is both dead simple and surprisingly robust.

The key function is [`toModelMessages()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/message.ts) which converts the internal Message/Part structure into the `ModelMessage[]` format the AI SDK expects. It handles the mapping from Quark’s typed parts to the SDK’s content format — including multi-modal content for tools that return images.

## 2.4 The Brain: Provider Resolution

Quark doesn’t hardcode any LLM provider. Models are specified as strings in `"provider/model"` format — for example `"copilot/claude-sonnet-4.5"`, `"openai/gpt-4o"`, or `"ollama/llama3"`.

The [`resolveModel()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/provider/resolver.ts#L14-L83) function is the single place where a model string becomes an actual AI SDK `LanguageModel` instance. It parses the spec, looks up the provider config from `~/.config/quark/config.yaml`, and dispatches to the right AI SDK factory:

```typescript
if (providerId === "copilot") {
  return createOpenAICompatible({ name: "copilot", baseURL: "https://api.githubcopilot.com", ... })(modelId)
}
if (providerId === "openai") {
  return createOpenAI({ apiKey, baseURL })(modelId)
}
if (providerId === "anthropic") {
  return createAnthropic({ apiKey, baseURL })(modelId)
}
// Fallback: any OpenAI-compatible API
return createOpenAICompatible({ name: providerId, baseURL, apiKey })(modelId)
```

The beauty of this is that Quark doesn’t care which provider you use. As long as there’s an OpenAI-compatible API, it works. This is why Quark can switch models mid-session: `resolveModel()` is called fresh at the start of every loop iteration, so changing the model via `/model` in the TUI takes effect on the very next turn.

Your curated model list lives in config:

```yaml
models:
  - copilot/claude-sonnet-4.5
  - openai/gpt-4o
  - ollama/llama3.2:latest
main_model: copilot/claude-sonnet-4.5
small_model: copilot/gpt-4o-mini
```

The `models` list drives the `/model` picker in the TUI. `main_model` is the default for the agent loop. `small_model` is used for lightweight tasks like auto-generating session titles.

## 2.5 The Loop

Now we have all three ingredients — tools, memory, brain. The loop is what makes them dance.

### Entry Point: `prompt()`

The [`prompt()` function](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/prompt.ts#L61-L171) is the public API. It:

1. Creates or resumes a session
2. Saves the user’s message (text + optional images)
3. Sets up an `AbortController` for cancellation
4. Fires a `loop-start` event
5. Delegates to `loop()`
6. Fires `loop-end` and cleans up

### The Heart: `loop()`

The [`loop()` function](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/prompt.ts#L211-L376) is where the agent actually runs. It’s a `while (true)` with seven steps:

```
while (true):
  1. Load conversation history from storage
  2. Build the system prompt
  3. Check if auto-branching is needed
  4. Create an assistant message row
  5. Resolve tools for this profile
  6. Call processStream() — stream the LLM response
  7. Decide: continue (tool calls need follow-up), branch (context too long), or stop
```

Step 7 is the critical decision point. `processStream()` returns one of three outcomes:

- **`"continue"`** — the LLM made tool calls. The loop must run again so the LLM can see the tool results and respond further. This is what makes the agent more than a single-turn chatbot.
- **`"stop"`** — the LLM finished its response with a stop reason. The task is done (for now).
- **`"branch"`** — the context window is nearly full. The loop triggers an automatic branch — it summarizes the conversation so far, creates a new child session with the summary as context, and continues there. The model never hits a context-length error.

There are safety rails: a `max_steps` config (default 50) prevents runaway loops, and the `abort.aborted` check at the top of every iteration lets the user cancel at any time.

### The Stream Processor

[`processStream()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/processor.ts) is a long function that wraps the AI SDK’s `streamText()`. It iterates over the stream events, persisting each part to storage and emitting typed events on the event bus:

| Stream Event | Persisted As | Bus Event |
|---|---|---|
| Text delta | `TextPartData` (appended to existing part) | `text-delta` |
| Tool call start | `ToolPartData` (status: `pending`) | `tool-start` |
| Tool input received | Update status to `awaiting_approval` | `tool-input` |
| Tool execution | Update status to `running` | `tool-running` |
| Tool result/error | Update status to `completed`/`error` | `tool-end` |
| Step finish | `StepFinishData` (tokens, cost) | `step-finish` |
| Reasoning delta | `ReasoningPartData` | `reasoning-delta` |

Every event carries the `sessionId` so the TUI knows which session to update. This is the bridge between the headless agent loop and the real-time interface — the TUI subscribes to these events and renders them as they arrive, with zero polling.

### Retry Logic

LLM calls fail. The [`retry.ts`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/session/retry.ts) module classifies errors: rate limits (429), context-too-long, and transient server errors are retried with exponential backoff. Non-retryable errors (bad API key, model not found) are thrown immediately. The retry logic also respects `Retry-After` headers when providers send them.

## 2.6 Putting It All Together

Here’s the complete flow from user input to agent response, annotated with the actual files:

```diagram
User types "fix the bug in main.ts"
         │
         ▼
   cli.ts → prompt()                    src/session/prompt.ts
         │
         ├─▶ createSession()            src/session/session.ts
         ├─▶ saveUserMessage()          src/session/message.ts
         │
         ▼
      loop()                            src/session/prompt.ts
         │
         ├─▶ loadMessages()             src/session/message.ts
         │     └─▶ replaySessionFile()  src/storage/session-jsonl.ts
         │
         ├─▶ buildSystem()              src/session/system.ts
         │
         ├─▶ resolveModel()             src/provider/resolver.ts
         │
         ├─▶ resolveToolSet()           src/tool/ai-adapter.ts
         │     └─▶ registry.get(id)     src/tool/registry.ts
         │
         └─▶ processStream()            src/session/processor.ts
                │
                ├─▶ streamText()        (AI SDK)
                ├─▶ on text-delta  → addPart() + bus.emit("text-delta")
                ├─▶ on tool-call   → addPart() + bus.emit("tool-start")
                └─▶ on tool-result → updatePart() + bus.emit("tool-end")
```

This is the skeleton. Every feature in the chapters ahead — profiles, skills, permissions, the TUI, the CLI — hangs off these four primitives. Profiles constrain which tools are available. Skills extend the system prompt. Permissions gate tool execution. The TUI visualizes the event stream. The CLI wires it all to a terminal.

## 2.7 Challenges and How I Solved Them

Building the agent core wasn’t all smooth sailing. Here are a few problems I hit early and how I worked through them.

### 2.7.1 GitHub Copilot Authentication

I wanted Copilot as a provider because GitHub’s free tier gives you unlimited access to Claude Sonnet and GPT-4o with no API keys to manage. But Copilot doesn’t use API keys — it uses GitHub’s **OAuth Device Flow**.

Here’s how it works: instead of generating a key in a dashboard and pasting it into config, you authenticate once through your browser. The [device flow](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/provider/copilot-auth.ts) has three steps:

1. **Request a device code** — POST to `github.com/login/device/code` with a static `client_id` and scope `read:user`. GitHub returns a `device_code`, a `user_code` (e.g., `ABCD-1234`), and a `verification_uri`.

2. **User authorizes in browser** — Quark prints the URL and code. You open `github.com/login/device`, enter the code, and authorize. Meanwhile, Quark polls `github.com/login/oauth/access_token` every few seconds.

3. **Token saved** — once authorized, GitHub returns an access token. Quark saves it to `~/.config/quark/copilot-token.json` and loads it from disk on every subsequent request.

The polling logic handles `authorization_pending` (keep waiting), `slow_down` (increase the interval), and `expired_token` (start over). The entire flow runs in the [login script](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/scripts/auth/copilot-login.ts), so users run it once and never think about it again.

But auth was only the first Copilot challenge. Actually calling the API required a [custom fetch wrapper](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/provider/copilot-fetch.ts) because Copilot requires three non-standard headers on every request:

- `Openai-Intent: conversation-edits` — tells Copilot’s API this is an agent conversation, not a one-shot completion
- `x-initiator: user | agent` — marks whether the request is a new user prompt or an agent loop continuation (tool results fed back). This matters because Copilot applies different rate limits and behaviors to each. Quark infers it from the last message’s role: if it’s not `"user"`, it’s `"agent"`.
- `Copilot-Vision-Request: true` — required when the request includes images, detected by scanning for `type: "image_url"` in message content

On top of that, Copilot’s API has two quirks that break the AI SDK:

1. **Missing `choices[].index`** — in non-streaming JSON responses, Copilot omits the `index` field on each choice. The `@ai-sdk/openai` provider crashes without it. Quark intercepts the response body and patches `index: i` onto each choice before the SDK sees it.

2. **Rotating reasoning item IDs** — on `/responses` SSE streams, Copilot emits a fresh `item.id` on every `output_item.done` event instead of reusing the one from `output_item.added`. The AI SDK looks up items by ID and loses them when the ID changes. Quark rewrites the stream in-flight: it captures the canonical ID from the `added` event and substitutes it into every subsequent `done` event for that `output_index`.

Neither of these hacks is elegant, but they’re confined to a single file — the rest of the codebase has no idea Copilot is quirky. That’s the value of the provider abstraction: weirdness gets walled off.

### 2.7.2 JSONL vs SQLite: Why Append-Only Wins

Early on, I had to decide how to store session data. The two obvious choices were SQLite and JSONL. Both are file-based, both work without a server, both are portable. The decision came down to one thing: what happens when two writes arrive at the same time.

During normal sequential tool calling — the agent calls `read`, waits for the result, then calls `write`, waits for the result — there’s no contention. `addPart()` and `updatePart()` are called one at a time from the stream event loop. Reads happen only at two points: when the TUI loads a session to display messages, and at the top of each loop iteration to build the conversation history for the LLM. Neither of these overlaps with a write. Sequential mode works fine with either storage backend.

But when the agent makes **parallel tool calls** — multiple tools in one response, executed concurrently by the AI SDK — you suddenly have two (or more) tool results racing to write to storage at the same time. That’s where the difference matters.

With **JSONL**, the answer is built into the operating system. Quark opens the file with `O_APPEND` and calls [`appendFileSync()`](file:///Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark/src/storage/session-jsonl.ts#L117-L143). POSIX guarantees that `O_APPEND` writes are atomic: the file offset is set to the end of the file before each write, and no other write can interleave between the seek and the write. Each `appendFileSync()` call becomes one contiguous JSON line at the end of the file. Two concurrent appends? Two lines, in some order, both intact. No locks, no journals, no coordination — the kernel handles it.

With **SQLite**, concurrent writes need WAL (Write-Ahead Logging) mode. Without WAL, one writer blocks all others — your parallel tool calls serialize at the storage layer, undoing the parallelism you wanted. With WAL, writers still contend for the write lock, and you now have an additional file (the WAL) that needs checkpointing. If the WAL grows too large, or a checkpoint fails mid-operation, or the process crashes before a checkpoint completes, you can lose writes. It’s not that WAL is broken — it works well for most applications — but for an append-only event log where every write is a single line and you never update in place, it’s a sledgehammer for a task that a single syscall handles perfectly.

The JSONL approach also has a nice secondary benefit: the session file *is* the source of truth. There’s no separate schema, no migration scripts, no ORM. You can `cat ~/.config/quark/session/<id>/session.jsonl` and see every event, in order, as human-readable JSON. Debugging a corrupted session is a text editor, not a database repair tool.

The tradeoff is that querying JSONL is slower than SQLite for anything beyond a linear replay. But Quark never needs to query across sessions, filter by timestamp, or join tables. It only ever replays one session file from top to bottom. So the tradeoff is pure upside.

---

But before we get to any of that, we need to talk about the single most important architectural decision in Quark: how profiles keep the agent’s context clean. That’s Chapter 3.
