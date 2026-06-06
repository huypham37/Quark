---
title: ChatGPT Consumer API Provider (Codex Streaming)
date_created: 2026-06-06
date_modified: 2026-06-06
revision: 2
history:
  - 2026-06-06: Initial draft
  - 2026-06-06: Verified against real API — model is gpt-5.5, not gpt-4o/o3/o4
status: done
---

## Problem

Quark has working OAuth for ChatGPT Plus/Pro subscriptions (`src/provider/codex-auth.ts`). The login flow completes and a consumer JWT is persisted. However, the current `resolver.ts` routes `codex/` model specs to `api.openai.com` via `createOpenAICompatible`, which rejects the consumer token with HTTP 403 because it lacks `api.model.read` scope.

The endpoint that accepts consumer tokens is `chatgpt.com/backend-api/codex/responses`. It uses SSE (or WebSocket) streaming with a custom request/response format that resembles the OpenAI Responses API but with Codex-specific fields.

## Decision

Build a custom AI SDK v3 provider that talks directly to `chatgpt.com/backend-api/codex/responses` over SSE. This keeps `processor.ts` untouched — the provider implements `LanguageModelV3.doStream()` and returns a `ReadableStream<LanguageModelV3StreamPart>` that `streamText()` consumes natively.

## Architecture

```
src/provider/
├── codex-auth.ts              (existing — JWT, refresh, device flow)
├── codex-fetch.ts             (existing — standard API fetch wrapper)
├── codex-consumer.ts          (NEW — AI SDK v3 provider factory)
├── codex-consumer-stream.ts    (NEW — SSE fetch, parse, event mapping)
├── codex-consumer-types.ts    (NEW — shared types)
├── resolver.ts                (MODIFY — route codex/ to new provider)
└── models.ts                  (MODIFY — update provider mapping if needed)
```

### Layer 1: Auth (reuse)
`codex-auth.ts` provides `loadToken()`, `refreshToken()`. The provider extracts `accountId` from the JWT payload claim `https://api.openai.com/auth.chatgpt_account_id`.

### Layer 2: Provider factory (`codex-consumer.ts`)
Implements `LanguageModelV3`:
- `provider: "codex"`
- `doStream(options)`:
  1. Convert AI SDK `prompt` to ChatGPT `input` messages
  2. Build request body: `model`, `store: false`, `stream: true`, `instructions` (system prompt), `input`, `text: { verbosity: "low" }`, `include: ["reasoning.encrypted_content"]`
  3. POST to `https://chatgpt.com/backend-api/codex/responses` with headers: `Authorization: Bearer <jwt>`, `chatgpt-account-id: <id>`, `originator: pi`, `OpenAI-Beta: responses=experimental`, `accept: text/event-stream`
  4. On non-2xx: parse error, apply retry logic for 429/5xx, then throw
  5. On 2xx: parse SSE, map each event to `LanguageModelV3StreamPart`
  6. Return `ReadableStream<LanguageModelV3StreamPart>`

### Layer 3: SSE parsing & event mapping (`codex-consumer-stream.ts`)
- `parseSSE(response, signal)` — AsyncGenerator yielding raw JSON objects from SSE `data:` lines
- `mapCodexEvents(events)` — AsyncGenerator converting ChatGPT events to AI SDK stream parts:
  - `response.output_text.delta` → `text-delta`
  - `response.reasoning_text.delta` → `reasoning-delta`
  - `response.function_call_arguments.delta` → `tool-input-delta`
  - `response.output_item.done` (function_call) → `tool-call`
  - `response.completed` / `response.done` → `finish`
  - `response.incomplete` → `finish` with `length` reason
  - `response.failed` / `error` → `error`

### Layer 4: Retry logic
Exponential backoff for 429, 500, 502, 503, 504. Respect `retry-after-ms` and `retry-after` headers. Max retries configurable (default 0 for now, same as Pi).

## Simplifications (MVP)

| Feature | Pi reference | Quark MVP |
|---|---|---|
| Transport | WebSocket + SSE | SSE only |
| Delta caching | `previous_response_id` via WS pool | None — full context each turn |
| Debug stats | Per-session counters | None |
| Service tier pricing | Cost multiplier applied | Not tracked (AI SDK handles usage) |
| Tool approval | Provider-executed tools | Standard AI SDK tool flow |

## Acceptance Criteria

1. `resolveModel("codex/gpt-5.5")` returns a `LanguageModelV3` that streams from `chatgpt.com/backend-api`
2. A valid Codex token (from `codex-login.ts`) is accepted — no 403
3. Text streaming works: `streamText()` with the model produces `text-delta` events
4. Reasoning blocks are forwarded as `reasoning-delta` events
5. Tool calls are forwarded as `tool-call` events
6. Finish events include correct `stop` / `length` finish reason
7. Rate-limit errors trigger retry with exponential backoff
8. All existing provider tests continue to pass

## Testing Strategy

- Mock `fetch` to return SSE responses with known event sequences
- Assert the provider yields expected `LanguageModelV3StreamPart` events
- Test retry logic with 429 responses
- Test JWT accountId extraction edge cases
- Test error event mapping (response.failed → error part)
