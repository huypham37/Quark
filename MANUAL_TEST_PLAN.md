# Atom — Manual Test Plan

## Prerequisites

### Environment
- **Bun runtime** installed (`bun --version` should return 1.x)
- Terminal that supports raw mode (iTerm2, Terminal.app, Alacritty, etc.)
- Internet access for Copilot API calls
- Project dependencies installed: `bun install`

### Authentication
- A valid Copilot token at `~/.config/atom/copilot-token.json`
- If missing, run: `bun scripts/copilot-login.ts`
- The login script will print a URL + code — authorize in browser, then token is saved automatically

### Verify Prerequisites
```bash
bun --version          # should print 1.x
bun test               # should show 128 pass, 0 fail
cat ~/.config/atom/copilot-token.json | head -1  # should show { "token": "ghu_..."
```

---

## Test 1: Unit Tests (Automated Baseline)

**Purpose**: Confirm all existing unit tests pass before manual testing.

```bash
bun test
```

**Expected**: 128 pass, 5 skip, 0 fail, 203 expect() calls

**If failing**: Fix before proceeding — manual tests depend on these passing.

---

## Test 2: Type Check

**Purpose**: Confirm no type errors in source code (TUI included).

```bash
bunx tsc --noEmit 2>&1 | grep "src/"
```

**Expected**: No output (no errors in `src/`). Pre-existing test file type errors are acceptable.

---

## Test 3: Copilot Login Flow

**Purpose**: Verify OAuth device flow and token persistence.

```bash
bun scripts/copilot-login.ts
```

**Steps**:
1. Run the command
2. It should print a verification URL and a user code
3. Open the URL in browser, enter the code, authorize
4. Script should print "Authorization successful!" and list available models
5. Script should send a test prompt to gpt-4o and print a response
6. Verify token file exists: `cat ~/.config/atom/copilot-token.json`

**Expected**:
- [ ] Device code URL and user code printed
- [ ] Token saved to `~/.config/atom/copilot-token.json`
- [ ] Models list printed (should include gpt-4o, gpt-5-mini, etc.)
- [ ] Test prompt returns a response
- [ ] Token file contains `{ "token": "...", "domain": "github.com", "savedAt": ... }`

---

## Test 4: E2E — Simple Prompt (No Tools)

**Purpose**: Verify the agent loop works end-to-end with a simple question.

```bash
bun scripts/e2e.ts "What is 2 + 2? Reply with just the number."
```

**Expected**:
- [ ] "Starting agent loop..." printed
- [ ] Completes in <5 seconds
- [ ] Session ID printed
- [ ] Messages: 2 (1 user + 1 assistant)
- [ ] USER message shows "What is 2 + 2? Reply with just the number."
- [ ] ASSISTANT message contains "4"
- [ ] step-finish shows token usage (non-zero input/output tokens)

---

## Test 5: E2E — Tool Usage (Read)

**Purpose**: Verify tools are invoked by the agent and results persisted.

```bash
bun scripts/e2e.ts "Read the package.json file and tell me the project name." --model gpt-5-mini
```

**Expected**:
- [ ] Agent invokes the `read` tool with `filePath` containing "package.json"
- [ ] Tool status = "completed"
- [ ] Tool output contains file content (should include `"name": "atom"`)
- [ ] ASSISTANT text references "atom" as the project name
- [ ] Multiple parts visible: text + tool + step-finish

---

## Test 6: E2E — Tool Usage (Bash)

**Purpose**: Verify bash tool execution.

```bash
bun scripts/e2e.ts "Run 'echo hello world' and tell me the output." --model gpt-5-mini
```

**Expected**:
- [ ] Agent invokes the `bash` tool with command `echo hello world` (or similar)
- [ ] Tool status = "completed"
- [ ] Tool output contains "hello world"
- [ ] ASSISTANT text mentions the output

---

## Test 7: E2E — Multi-Step Tool Usage

**Purpose**: Verify the agent loop continues after tool calls (multi-step).

```bash
bun scripts/e2e.ts "List the files in the src/ directory, then read src/agent.ts and tell me the default max steps." --model gpt-5-mini
```

**Expected**:
- [ ] Agent invokes `read` tool at least twice (directory listing + file read)
- [ ] All tool statuses = "completed"
- [ ] ASSISTANT text mentions `maxSteps` value (should be 50 based on defaultAgent)
- [ ] Multiple step-finish parts with token counts

---

## Test 8: TUI — Visual Demo (No Backend)

**Purpose**: Verify TUI renders correctly with mock data.

```bash
bun scripts/tui-demo.tsx
```

**Expected**:
- [ ] Tool result lines visible: `✓ Read 01-CodeSpace/Personal-Lab`, `✓ Read package.json`, `✓ Read 01-CodeSpace/Work`
- [ ] Assistant text rendered with bold and bullet points
- [ ] User message visible: `│ use oracle` (with left bar)
- [ ] Thinking indicator: `✓ Thinking ▶`
- [ ] Tool invocation block: `· Skill` with `└──` tree connector and description
- [ ] Status bar: `─10% of 168k · $0.56 (free)───smart──1 skill─`
- [ ] Empty input box (bordered)
- [ ] Footer: `⇄ Running tools...  Esc to cancel`
- [ ] No crash or uncaught errors
- [ ] Process exits cleanly

---

## Test 9: TUI — Live Interactive Session

**Purpose**: Verify full TUI ↔ backend wiring with real Copilot API.

```bash
bun src/tui/index.tsx
```

**Steps**:
1. TUI should render with empty message list, status bar, input box
2. Type a simple prompt: `What is the capital of France?` and press Enter
3. Observe streaming behavior
4. Wait for response to complete
5. Type a follow-up: `And what about Germany?` and press Enter
6. Observe multi-turn conversation
7. Press Ctrl+C to exit

**Expected**:
- [ ] Input box accepts keystrokes and shows cursor
- [ ] After Enter, user message appears with `│ What is the capital of France?`
- [ ] Footer shows `⇄ Running tools...  Esc to cancel` while processing
- [ ] Input box becomes disabled (grayed) during processing
- [ ] Assistant text streams in (appears incrementally, not all at once)
- [ ] After completion, footer disappears
- [ ] Input box re-enables for next prompt
- [ ] Status bar updates with token count
- [ ] Second prompt works — conversation continues
- [ ] Ctrl+C exits cleanly

---

## Test 10: TUI — Tool Call Rendering

**Purpose**: Verify tool calls render correctly in the TUI.

```bash
bun src/tui/index.tsx
```

**Steps**:
1. Type: `Read the file package.json` and press Enter
2. Observe tool call rendering

**Expected**:
- [ ] Tool invocation appears (pending state: `… Read`)
- [ ] After completion, shows: `✓ Read package.json` (or similar path)
- [ ] Assistant text follows with file content summary
- [ ] Status bar token count increases

---

## Test 11: TUI — Cancel Running Operation

**Purpose**: Verify Esc cancels a running agent loop.

```bash
bun src/tui/index.tsx
```

**Steps**:
1. Type a prompt that will take time (e.g. `Analyze all files in the src/ directory and summarize each one`)
2. Press Enter
3. While "Running tools..." is visible, press Esc
4. Observe behavior

**Expected**:
- [ ] Footer shows `⇄ Running tools...  Esc to cancel`
- [ ] Pressing Esc stops the agent loop
- [ ] Footer disappears
- [ ] Input box re-enables
- [ ] No crash — partial response may be visible
- [ ] Can type a new prompt after cancel

---

## Test 12: TUI — Error Handling (No Token)

**Purpose**: Verify TUI handles missing Copilot token gracefully.

**Steps**:
1. Temporarily rename token file: `mv ~/.config/atom/copilot-token.json ~/.config/atom/copilot-token.json.bak`
2. Run: `bun src/tui/index.tsx`
3. Type any prompt and press Enter
4. Observe behavior
5. Restore token: `mv ~/.config/atom/copilot-token.json.bak ~/.config/atom/copilot-token.json`

**Expected**:
- [ ] TUI renders (session creation doesn't need a token)
- [ ] After submitting a prompt, an error occurs
- [ ] Error message mentions missing Copilot token
- [ ] TUI does NOT crash (error is caught)
- [ ] Input box re-enables after error

---

## Test 13: Event Bus — Events Fire Correctly

**Purpose**: Verify the event bus emits all expected events during a session.

Create a temporary test script:

```bash
cat > /tmp/atom-bus-test.ts << 'EOF'
import { bootstrap } from "./src/bootstrap"
import { prompt } from "./src/session/prompt"
import { bus } from "./src/session/events"

bootstrap()

const events: string[] = []
const allEvents = [
  "user-message", "loop-start", "loop-end",
  "assistant-message-start", "assistant-message-end",
  "text-start", "text-delta", "text-end",
  "step-start", "step-finish",
] as const

for (const name of allEvents) {
  bus.on(name, (data) => {
    events.push(name)
    if (name === "text-delta") return // too noisy
    console.log(`[BUS] ${name}`)
  })
}

await prompt({
  parts: [{ type: "text", text: "Say hello in one word." }],
})

console.log("\n=== Events fired ===")
console.log(`Total: ${events.length}`)
const unique = [...new Set(events)]
console.log(`Unique: ${unique.join(", ")}`)

// Verify expected events
const required = ["loop-start", "assistant-message-start", "text-start", "text-delta", "text-end", "step-finish", "assistant-message-end", "loop-end"]
for (const r of required) {
  const found = events.includes(r)
  console.log(`  ${found ? "✓" : "✗"} ${r}`)
}
EOF
bun /tmp/atom-bus-test.ts
```

**Expected**:
- [ ] All required events fire: loop-start, assistant-message-start, text-start, text-delta, text-end, step-finish, assistant-message-end, loop-end
- [ ] Events fire in correct order (start before end)
- [ ] text-delta fires multiple times (streaming)
- [ ] No events are missing

---

## Test 14: Event Bus — Tool Events

**Purpose**: Verify tool-specific events fire during tool invocations.

Similar to Test 13 but with a tool-triggering prompt:

```bash
cat > /tmp/atom-tool-bus-test.ts << 'EOF'
import { bootstrap } from "./src/bootstrap"
import { prompt } from "./src/session/prompt"
import { bus } from "./src/session/events"

bootstrap()

const events: string[] = []
const toolEvents = ["tool-start", "tool-input", "tool-end"] as const
for (const name of toolEvents) {
  bus.on(name, (data: any) => {
    events.push(name)
    console.log(`[BUS] ${name} tool=${data.tool} callId=${data.callId?.slice(0,8)}`)
  })
}
bus.on("loop-end", () => {
  console.log("\n=== Tool events ===")
  for (const r of toolEvents) {
    const count = events.filter(e => e === r).length
    console.log(`  ${count > 0 ? "✓" : "✗"} ${r}: ${count} time(s)`)
  }
})

await prompt({
  parts: [{ type: "text", text: "Read the file package.json and tell me the project name." }],
})
EOF
bun /tmp/atom-tool-bus-test.ts
```

**Expected**:
- [ ] tool-start fires at least once (for the read tool)
- [ ] tool-input fires with `tool=read` and input containing filePath
- [ ] tool-end fires with `status=completed`
- [ ] Events fire in order: tool-start → tool-input → tool-end

---

## Test 15: DB Persistence

**Purpose**: Verify messages and parts survive across process restarts.

**Steps**:
1. Run an e2e test: `bun scripts/e2e.ts "What is 3 + 3?" --model gpt-5-mini`
2. Note the Session ID from output
3. Verify data in SQLite:

```bash
bun -e "
import { getDB } from './src/storage/db'
import { initDB } from './src/storage/db'
initDB()
const db = getDB()
const sessions = db.query('SELECT id, title FROM session ORDER BY time_created DESC LIMIT 5').all()
console.log('Sessions:', sessions)
const messages = db.query('SELECT id, role, session_id FROM message ORDER BY time_created DESC LIMIT 10').all()
console.log('Messages:', messages)
const parts = db.query('SELECT id, type, message_id FROM part LIMIT 20').all()
console.log('Parts:', parts)
"
```

**Expected**:
- [ ] Session row exists with the noted session ID
- [ ] Message rows exist (user + assistant)
- [ ] Part rows exist (text, step-start, step-finish, possibly tool)
- [ ] Data persists after the process exits (SQLite file-based)

---

## Test 16: TUI State Reducer (Unit-Level Sanity)

**Purpose**: Quick manual check that the reducer handles all action types.

```bash
bun -e "
import { initialState, reduce } from './src/tui/state/state'

let s = initialState()
console.log('Initial:', s.sessionId, s.messages.length, s.running)

s = reduce(s, { type: 'set-session', sessionId: 'test-123' })
console.log('After set-session:', s.sessionId)

s = reduce(s, { type: 'add-user-message', id: 'u1', text: 'hello' })
console.log('After add-user-message:', s.messages.length, s.messages[0]?.parts[0])

s = reduce(s, { type: 'add-assistant-message', id: 'a1' })
console.log('After add-assistant-message:', s.messages.length, s.messages[1]?.streaming)

s = reduce(s, { type: 'text-start', messageId: 'a1' })
s = reduce(s, { type: 'text-delta', messageId: 'a1', delta: 'Hi', text: 'Hi' })
s = reduce(s, { type: 'text-delta', messageId: 'a1', delta: ' there', text: 'Hi there' })
s = reduce(s, { type: 'text-end', messageId: 'a1', text: 'Hi there' })
const textPart = s.messages[1]?.parts[0]
console.log('After text lifecycle:', textPart)

s = reduce(s, { type: 'tool-start', messageId: 'a1', tool: 'read', callId: 'tc1' })
s = reduce(s, { type: 'tool-input', messageId: 'a1', callId: 'tc1', input: { filePath: 'test.ts' } })
s = reduce(s, { type: 'tool-end', messageId: 'a1', callId: 'tc1', status: 'completed', output: 'file content' })
const toolPart = s.messages[1]?.parts[1]
console.log('After tool lifecycle:', toolPart)

s = reduce(s, { type: 'set-running', running: true })
console.log('Running:', s.running)
s = reduce(s, { type: 'set-running', running: false })
console.log('Not running:', s.running)

s = reduce(s, { type: 'assistant-done', messageId: 'a1' })
console.log('Streaming after done:', s.messages[1]?.streaming)

console.log('\\n=== All reducer actions work ===')
"
```

**Expected**:
- [ ] All state transitions produce correct values
- [ ] Text accumulates across deltas
- [ ] Tool lifecycle (pending → running → completed) works
- [ ] running flag toggles
- [ ] streaming flag clears on assistant-done

---

## Summary Checklist

| #  | Test                           | Type         | Requires Token |
|----|--------------------------------|--------------|----------------|
| 1  | Unit tests                     | Automated    | No             |
| 2  | Type check                     | Automated    | No             |
| 3  | Copilot login flow             | Manual       | No (creates it)|
| 4  | E2E simple prompt              | Script       | Yes            |
| 5  | E2E tool usage (read)          | Script       | Yes            |
| 6  | E2E tool usage (bash)          | Script       | Yes            |
| 7  | E2E multi-step tools           | Script       | Yes            |
| 8  | TUI visual demo                | Visual       | No             |
| 9  | TUI live interactive           | Interactive  | Yes            |
| 10 | TUI tool call rendering        | Interactive  | Yes            |
| 11 | TUI cancel operation           | Interactive  | Yes            |
| 12 | TUI error handling (no token)  | Interactive  | No (tests absence) |
| 13 | Event bus — core events        | Script       | Yes            |
| 14 | Event bus — tool events        | Script       | Yes            |
| 15 | DB persistence                 | Script       | Yes            |
| 16 | TUI state reducer              | Script       | No             |

### Recommended Order
1. Tests 1-2 (automated baseline)
2. Test 3 (login — only if token missing)
3. Test 16 (reducer sanity — no network)
4. Test 8 (visual demo — no network)
5. Tests 4-7 (e2e scripts)
6. Tests 13-14 (event bus)
7. Test 15 (DB persistence)
8. Tests 9-12 (interactive TUI)
