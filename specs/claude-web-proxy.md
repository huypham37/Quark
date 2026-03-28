# Claude Web Proxy: Atom → Proxy → Webapp Architecture

**Status:** Implemented & running  
**Proxy process:** `scripts/claude-web-proxy.py` (PID managed by tmux `proxy-agent`)  
**Listening on:** `http://127.0.0.1:4318/v1`

---

## Problem

Atom needs a Claude model backend. The official Anthropic API requires a paid key. The claude.ai webapp offers free-tier access to Sonnet/Haiku models, but it is protected by Cloudflare and uses a non-standard SSE streaming API rather than the OpenAI-compatible format Atom's AI SDK expects.

---

## Decision

Run a local Python proxy (`claude-web-proxy.py`) that:

1. Exposes an **OpenAI-compatible** endpoint at `http://127.0.0.1:4318/v1/chat/completions`
2. Translates incoming requests to **claude.ai webapp API** calls
3. Uses **`curl_cffi` with Safari TLS impersonation** to bypass Cloudflare
4. Implements **tool calling** via prompt-engineering + response parsing (the webapp endpoint does not support native tool calls)

Atom's config sets `main_provider: claude-web-proxy` and `sub_provider: claude-web-proxy`. The AI SDK in Atom uses `@ai-sdk/openai` pointed at the proxy — no Anthropic SDK needed.

---

## Architecture

```
Atom (TypeScript / Bun)
  └─ AI SDK (@ai-sdk/openai)
       └─ POST http://127.0.0.1:4318/v1/chat/completions
            │
            ▼
  claude-web-proxy.py  (Python, HTTP server on port 4318)
  ┌─────────────────────────────────────────────────────┐
  │  1. Load session cookies from Electron SQLite store  │
  │  2. Inject tool schemas into prompt (text preamble)  │
  │  3. Create a fresh conversation per request          │
  │  4. POST to claude.ai /completion (curl_cffi)        │
  │  5. Stream SSE back; parse <tool_call> tags          │
  │  6. Emit synthetic OpenAI delta.tool_calls chunks    │
  └─────────────────────────────────────────────────────┘
            │
            ▼
  claude.ai webapp API  (https://claude.ai)
  POST /api/organizations/{org}/chat_conversations/{id}/completion
```

---

## Cloudflare Bypass

Plain `requests` / `httpx` get a 403 from Cloudflare on claude.ai. The proxy uses:

```python
from curl_cffi import requests as cffi_requests
cffi_requests.post(..., impersonate="safari17_0")
```

`curl_cffi` replicates Safari's TLS fingerprint (JA3 hash, ALPN, cipher order), making the connection indistinguishable from a real Safari browser. All cookies from the Claude Electron app are sent alongside the session key.

---

## Authentication & Cookies

### Session key
Stored at `~/.config/atom/claude-web-proxy-token.json`:
```json
{"apiKey": "sk-ant-sid02-..."}
```
Also readable from env var `CLAUDE_WEB_PROXY_API_KEY`.

### Cookie decryption
The Electron app stores cookies in an encrypted SQLite database:

| Field | Value |
|---|---|
| DB path | `~/Library/Application Support/Claude/Cookies` |
| Encryption | AES-128-CBC, `v10` prefix, IV = 16 space bytes |
| Key derivation | PBKDF2(sha1, password=keychain_password, salt=`saltysalt`, iterations=1003, dklen=16) |
| Keychain service | `"Claude Safe Storage"` (macOS Keychain) |

All cookies are sent on every request — `cf_clearance`, `__cf_bm`, `sessionKey`, and others are required for Cloudflare to pass the request.

### Org UUID
Auto-discovered via `GET /api/organizations` on first call, then cached at `~/.config/atom/claude-org-uuid.txt`.

---

## Claude.ai Webapp API

| Action | Endpoint |
|---|---|
| Create conversation | `POST /api/organizations/{org}/chat_conversations` |
| Send message & stream | `POST /api/organizations/{org}/chat_conversations/{id}/completion` |

### SSE format from webapp
```
event: completion
data: {"type":"completion","completion":" text chunk","stop_reason":null,...}

event: completion
data: {"type":"completion","completion":"","stop_reason":"end_turn",...}
```
Stop is signalled by `stop_reason` becoming non-null in a data line — there is no separate `[DONE]` marker.

### Request body
```json
{
  "prompt": "<human-turn assembled prompt>",
  "model": "claude-sonnet-4-6",
  "timezone": "UTC",
  "attachments": [],
  "files": []
}
```
The `tools` field is **ignored** by this endpoint. Tool calling is handled entirely in the proxy layer.

---

## Available Models (Free Tier)

Only these model IDs are accessible without a paid plan. Others return 403.

| Model ID | Name |
|---|---|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 ← **active** |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-20250514` | Claude Sonnet 4 |

---

## Tool Calling

The webapp completion endpoint ignores OpenAI-format `tools` fields. Tool calling is implemented via **prompt engineering + response parsing**.

### Flow

1. **Inject**: Proxy builds a text preamble listing all tool schemas and instructions:
   ```
   You have access to the following tools. When you need to use a tool, output:
   <tool_call>
   {"name": "tool_name", "arguments": {"arg1": "value1"}}
   </tool_call>
   ```
   This preamble is prepended to the system message (or first Human turn if no system message exists).

2. **Stream**: Raw text from the webapp streams through `ToolCallParser`, which incrementally scans for `<tool_call>...</tool_call>` blocks.

3. **Emit**: When a complete `<tool_call>` block is found:
   - Proxy emits `delta.tool_calls` SSE chunks in OpenAI format (index, function name, arguments)
   - If only text was produced (no tool calls), proxy emits `delta.content` text chunks
   - On stream end, `finish_reason` is `"tool_calls"` if any tool calls were found, else `"stop"`

4. **Tool results**: Incoming `role: "tool"` messages from Atom are serialized back into the prompt as:
   ```
   Human: <tool_result tool_call_id="...">
   {result content}
   </tool_result>
   ```

### Conversation history
Each OpenAI request carries the full message history. The proxy reconstructs the claude.ai prompt string by walking the messages list:

| OpenAI role | Prompt segment |
|---|---|
| `system` | `Human: <system>\n{content}\n</system>` (tool preamble prepended here) |
| `user` | `Human: {content}` |
| `assistant` | `Assistant: {content}` (tool calls serialized as `<tool_call>` blocks) |
| `tool` | `Human: <tool_result tool_call_id="...">\n{content}\n</tool_result>` |

---

## Atom Provider Wiring

| File | Role |
|---|---|
| `src/provider/provider.ts` | `createClaudeWebProxyProvider()` — creates `@ai-sdk/openai` instance at proxy URL |
| `src/provider/claude-web-proxy-auth.ts` | `loadClaudeWebProxyApiKey()` — reads from env or token file |
| `src/session/prompt.ts` | `resolveModel()` — routes to proxy provider when `providerId === "claude-web-proxy"` |
| `src/config/config.ts` | `main_provider`, `sub_provider`, `small_provider` fields; `getProviderId()` |

### Config (`~/.config/atom/config.yaml`)
```yaml
main_model: claude-sonnet-4-6
main_provider: claude-web-proxy
sub_provider: claude-web-proxy
```

---

## Known Gaps

| Gap | Impact | Fix |
|---|---|---|
| `small_provider` not set | Title generation falls back to `copilot` (fails without copilot token) | Add `small_provider: claude-web-proxy` to config.yaml |
| `/v1/models` returns 404 | Some AI SDK paths may fail; currently non-blocking | Add `GET /v1/models` handler to proxy |
| No auto-spawn from Atom | If proxy dies, Atom silently fails with connection error | Health-check + spawn proxy as child process on Atom startup |

---

## Startup

```bash
# Start proxy in persistent tmux session with auto-restart
bash scripts/start-claude-proxy.sh

# Or directly
python3 scripts/claude-web-proxy.py
```
