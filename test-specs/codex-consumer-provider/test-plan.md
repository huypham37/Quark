---
title: ChatGPT Consumer API Provider Test Plan
date_created: 2026-06-06
date_modified: 2026-06-06
revision: 1
history:
  - 2026-06-06: Initial draft — TDD failing tests
status: draft
---

## Objective

Validate the new `src/provider/codex-consumer.ts` — a custom AI SDK v3 language model
provider that talks to `chatgpt.com/backend-api/codex/responses` via SSE. Tests must
fail now (no implementation exists) and pass once the provider is built.

## Scope

### In-Scope

1. **Provider construction**: Factory function creates a `LanguageModelV3` instance with
   correct `provider`, `modelId`, `specificationVersion`.
2. **HTTP request shape**: `doStream` POSTs to the correct URL with required headers
   and request body fields.
3. **Token handling**: JWT is passed as `Authorization: Bearer`, account ID extracted
   from JWT and sent as `chatgpt-account-id` header.
4. **SSE parsing**: Raw SSE text is parsed into `LanguageModelV3StreamPart` events
   covering all mapped event types.
5. **Event mapping**: Full mapping table from ChatGPT SSE events to AI SDK stream parts.
6. **Retry logic**: 429 and 5xx responses trigger exponential backoff with configurable
   max retries.
7. **Error handling**: Non-retryable HTTP errors, malformed SSE, and network failures
   produce appropriate errors.

### Out-of-Scope

- `doGenerate` (non-streaming) — not implemented for consumer API.
- `supportedUrls` — returns empty record (consumer API doesn't support native file URLs).
- Integration with resolver.ts — tested separately in resolver-codex.test.ts.
- Real end-to-end HTTP calls — all HTTP is mocked via injectable fetch.
- Login flow / token persistence — handled by existing codex-auth.ts.

### Test Types

- **Functional**: Provider interface compliance, HTTP request shape, SSE parsing, event mapping.
- **Non-functional**: Retry with exponential backoff timing.
- **Negative**: Malformed SSE, HTTP errors, network failures, invalid tokens.

## Test Strategy

- **Framework**: `bun:test` (matches project convention).
- **Mocking**: Global `fetch` is mocked using injectable `FetchFn` type from `codex-auth.ts`,
  following the pattern established in `test/provider/codex-auth.test.ts` and
  `test/provider/codex-fetch.test.ts`.
- **SSE simulation**: Mock fetch returns `Response` objects with `ReadableStream` bodies
  containing SSE-formatted text.
- **TDD approach**: All tests are written to FAIL because `src/provider/codex-consumer.ts`
  does not exist. Import will throw.

## Test Files

| File | Focus |
|------|-------|
| `test/provider/codex-consumer.test.ts` | Provider construction, HTTP request shape, headers, body, retry, error handling |
| `test/provider/codex-consumer-stream.test.ts` | SSE parsing function, event mapping, edge cases |

## Environment

- **OS**: macOS (darwin arm64) or Linux
- **Runtime**: Bun (latest), `bun:test`
- **Dependencies**: `ai` (v6), `@ai-sdk/provider` (v3), no external services

## Entry/Exit Criteria

- **Entry**: Test files exist, `bun test` runs them, they all FAIL with import errors.
- **Exit**: After implementation exists, all tests PASS. No false positives.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI SDK v3 types change upstream | Pin `@ai-sdk/provider` version; tests serve as regression guard |
| ChatGPT SSE format changes | Event mapping is isolated in parsing function; focused stream tests catch regressions |
| Test fragility from mocked fetch | Use typed mock helpers with clear contracts; avoid testing internal implementation details |
