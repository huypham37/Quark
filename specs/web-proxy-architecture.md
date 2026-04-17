# Web-Proxy Architecture

## Overview

The web-proxy is a unified Python HTTP server that exposes an **OpenAI-compatible API** and forwards requests to web-based LLM providers (Qwen, Claude, Perplexity, Meta) that don't have public APIs. It normalises all provider-specific streaming formats into a single OpenAI SSE wire format consumed by the Quark TypeScript core via `@ai-sdk/alibaba`.

---

## Full Stack Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Quark TypeScript                         │
│                                                                 │
│  prompt.ts                                                      │
│  resolveModel("web/qwen3.6-plus")                               │
│    └─ createAlibabaCompatibleProvider({ baseURL: :4320/v1 })    │
│         └─ alibabaProvider("web/qwen3.6-plus")  ← LanguageModel │
│                          │                                       │
│  processor.ts            │                                       │
│  streamText({ model })◄──┘                                      │
│    └─ result.fullStream                                         │
│         ├─ text-delta                                           │
│         ├─ reasoning-delta      (mapped from reasoning_content) │
│         └─ tool-call                                            │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP POST /v1/chat/completions
                     │ @ai-sdk/alibaba handles raw SSE parsing
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│               web-proxy  (Python, 127.0.0.1:4320)               │
│                                                                 │
│  server.py                                                      │
│  POST /v1/chat/completions                                      │
│    └─ ProviderRegistry.resolve(model)                           │
│         │                                                       │
│         ├─ "web/qwen*"       → QwenProvider                     │
│         ├─ "web/claude*"     → ClaudeProvider                   │
│         ├─ "web/perplexity"  → PerplexityProvider               │
│         └─ "web/meta-ai"     → MetaProvider                     │
│                   │                                             │
│         WebProvider.stream()                                    │
│           ├─ _build_prompt(messages, tools)                     │
│           │    └─ tools.py: inject tool preamble if needed      │
│           ├─ _raw_stream(prompt, model)                         │
│           │    └─ hits the actual web UI API                    │
│           └─ yields abstract events                             │
│                ├─ TextDelta                                     │
│                ├─ ReasoningDelta                                │
│                └─ ToolCall  (native or parsed from <tool_call>) │
│                          │                                      │
│         sse.py: convert → OpenAI SSE wire format                │
│           ├─ delta.content           (TextDelta)                │
│           ├─ delta.reasoning_content (ReasoningDelta)           │
│           └─ delta.tool_calls        (ToolCall)                 │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS  (browser impersonation via curl_cffi)
          ┌──────────┼──────────────────┐
          ▼          ▼                  ▼
     chat.qwen.ai  claude.ai    perplexity.ai / meta.ai
```

---

## Tool Call Paths

Two strategies depending on whether the provider supports native function calling:

```
Native (Qwen)                    Injected (Claude, Meta)
─────────────────────            ──────────────────────────────────
provider emits                   tools.py injects preamble into prompt
  function_call deltas           provider emits raw text with:
       │                           <tool_call>{"name":...}</tool_call>
       ▼                                    │
  converted to ToolCall event    ToolCallParser detects XML block
       │                                    │
       └────────────────────────────────────┘
                                 │
                          ToolCall event → SSE delta.tool_calls
```

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/web-proxy/run.py` | Entry point — registers providers, `authenticate_all()`, starts `HTTPServer` |
| `web_proxy/server.py` | HTTP handler — routes, streaming + non-streaming responses |
| `web_proxy/base.py` | `WebProvider` ABC, event types (`TextDelta`, `ReasoningDelta`, `ToolCall`, `Done`), `ProviderRegistry` |
| `web_proxy/sse.py` | Converts abstract events → OpenAI SSE wire format |
| `web_proxy/tools.py` | Tool preamble injection + `ToolCallParser` (XML `<tool_call>` blocks) |
| `web_proxy/auth.py` | Token loading: env var → `~/.config/quark/<file>` |
| `web_proxy/providers/qwen.py` | Qwen adapter — native function_call deltas, phase-based reasoning |
| `web_proxy/providers/claude.py` | Claude adapter — Electron cookie DB auth, prompt-injected tools |
| `web_proxy/providers/perplexity.py` | Perplexity adapter — search-only, no tools/reasoning |
| `web_proxy/providers/meta.py` | Meta adapter — thinking sections as `ReasoningDelta` |
| `src/provider/provider.ts` | `createAlibabaCompatibleProvider` — points `@ai-sdk/alibaba` at the proxy |
| `src/provider/claude-web-proxy-auth.ts` | Save/load Claude session token at `~/.config/quark/` |

---

## Provider Capabilities

| Model prefix | Provider | Auth | Tool calls | Reasoning |
|---|---|---|---|---|
| `web/qwen*` | chat.qwen.ai | JWT cookie | Native `function_call` deltas | `delta.reasoning_content` / `phase="think"` |
| `web/claude*` | claude.ai webapp | Session key + Electron cookie DB | Prompt injection + `<tool_call>` XML | Not emitted |
| `web/perplexity` | perplexity.ai | `__Secure-next-auth.session-token` | Not supported | Not supported |
| `web/meta-ai` | meta.ai | `rd_challenge` + `ecto_1_sess` cookies | Not supported | `ReasoningDelta` (thinking sections) |

---

## Reasoning Token Flow

```
web-proxy SSE:  delta.reasoning_content
                        │
              @ai-sdk/alibaba (parses SSE)
                        │
              reasoning-start / reasoning-delta / reasoning-end
                        │
              processor.ts fullStream handler
```

Quark uses `@ai-sdk/alibaba` (not `@ai-sdk/openai`) precisely because Alibaba's SDK natively maps `delta.reasoning_content` to the AI SDK's reasoning event types. Quark's core never sees raw SSE — it only consumes normalized `fullStream` events.

---

## Auth

All providers load tokens via the same pattern (`auth.py`):

```
env var  →  ~/.config/quark/<token-file>  →  RuntimeError with setup instructions
```

Failed auth marks the provider as not-ready but does not crash the server. `/health` reports which providers are ready.

---

## HTTP Surface

| Endpoint | Description |
|---|---|
| `GET /health` | Lists ready providers |
| `GET /v1/models` | OpenAI-style model list from all ready providers |
| `POST /v1/chat/completions` | Main chat endpoint — streaming and non-streaming |
