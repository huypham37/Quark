---
title: OpenAI Codex OAuth Test Plan
date_created: 2026-06-06
date_modified: 2026-06-06
revision: 1
history:
  - 2026-06-06: Initial draft — TDD test plan before implementation
status: draft
---

# OpenAI Codex (ChatGPT Plus/Pro) OAuth — Test Plan

## Objective

Verify that the OpenAI Codex OAuth subsystem correctly implements:
1. **Browser PKCE flow** — local callback server on port 1455, authorization URL generation, code exchange
2. **Device code flow** (RFC 8628) — device auth initiation, polling, token acquisition
3. **Token refresh** with auto-refresh on expiry
4. **PKCE utilities** — code verifier/challenge generation using Web Crypto API
5. **Fetch wrapper** — Bearer auth header injection
6. **Resolver integration** — `codex/` model spec routing in resolver.ts

## Test Strategy

### Approach
- **TDD-first**: All tests written before implementation. Tests fail initially (modules don't exist).
- **Unit tests**: Each function tested in isolation with mocked `fetch`.
- **Integration tests**: Resolver integration with real or mocked token persistence.
- **No live API tests in this phase**: All HTTP calls mocked via injectable `FetchFn`.

### Test Types
| Type | Coverage |
|------|----------|
| Functional (happy path) | PKCE generation, all auth flows, token persistence |
| Functional (error paths) | Malformed tokens, missing fields, HTTP errors, state mismatch, corrupt persistence |
| Edge cases | Empty accountId, expired tokens, abort signals mid-flow |
| Integration | Resolver routing to codex provider, auto-refresh on expiry |

### Technique
- `bun:test` framework (same as existing `copilot-auth.test.ts`)
- Injectable `FetchFn` mock pattern (consistent with `copilot-auth.ts`)
- `tmp` directories for file I/O tests, cleaned up after each test
- JWT helpers for generating known test tokens
- `node:http` server mocking for browser flow tests

## Environment

- **Runtime**: Bun >= 1.2
- **OS**: macOS (CI: Linux)
- **Dependencies**: None beyond Bun built-ins
- **Test files**:
  - `test/provider/pkce.test.ts`
  - `test/provider/codex-auth.test.ts`
  - `test/provider/codex-fetch.test.ts`
  - `test/provider/resolver-codex.test.ts`

## Entry/Exit Criteria

### Entry
- Test files exist at specified paths
- Source files to test are declared (exist as stubs or not yet created — TDD)

### Exit
- All test cases pass when implementation is complete
- Each test is atomic and tests one behavior
- Mock fetch captures validate exact HTTP calls (URL, method, body, headers)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `node:http` not available in Bun test | Use conditional mocking; Bun supports `node:http` |
| Web Crypto API differences | Test base64url encoding explicitly |
| Port 1455 conflicts in parallel tests | Mock server creation, don't actually listen |
| Token file path conflicts | Use `tmp` directories with cleanup |

## Test Files & Target Source Files

| Test File | Target Source File | Status |
|-----------|-------------------|--------|
| `test/provider/pkce.test.ts` | `src/provider/pkce.ts` | Source DOES NOT EXIST |
| `test/provider/codex-auth.test.ts` | `src/provider/codex-auth.ts` | Source DOES NOT EXIST |
| `test/provider/codex-fetch.test.ts` | `src/provider/codex-fetch.ts` | Source DOES NOT EXIST |
| `test/provider/resolver-codex.test.ts` | `src/provider/resolver.ts` (modification) | Source EXISTS, codex branch MISSING |
