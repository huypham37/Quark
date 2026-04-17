# Test Plan — Issue #86: Unified Web-Proxy Package
**Branch:** `feat/unified-web-proxy`
**Date:** 2026-04-09

---

## Objective

Verify that the unified web-proxy package (Python) and the corresponding Quark TypeScript provider changes work correctly in isolation. This covers:

1. The **TypeScript provider layer** (`src/provider/provider.ts` + `src/session/prompt.ts`) — specifically the new `createAlibabaCompatibleProvider` function and the `resolveModel` routing branch that sends `web/*` models through `@ai-sdk/alibaba` instead of `@ai-sdk/openai`.
2. The **Python web-proxy internals** (`scripts/web-proxy/web_proxy/`) — the four core modules: `base.py`, `sse.py`, `tools.py`, and `auth.py`.

---

## Scope

### In Scope
| Area | What is Tested |
|---|---|
| `src/provider/provider.ts` | `createAlibabaCompatibleProvider` — construction, model creation, provider identity |
| `src/session/prompt.ts` | `resolveModel` web-routing branch (validated indirectly via provider contracts) |
| `web_proxy/base.py` | `ProviderRegistry`: register, authenticate_all, resolve, all_models; `WebProvider.is_ready()`; event dataclasses |
| `web_proxy/sse.py` | All six SSE builders + `make_id` + `non_stream_response` |
| `web_proxy/tools.py` | `build_tool_preamble`, `messages_to_prompt`, `ToolCallParser.feed/flush` |
| `web_proxy/auth.py` | `load_token_file` — env var, file, missing, malformed |

### Out of Scope
- Live network calls to qwen, claude, perplexity, meta web endpoints
- End-to-end agent loop integration (requires DB + copilot token)
- The HTTP server (`server.py`) — that's an integration test
- Individual provider implementations (`providers/*.py`)
- TUI-level tests

---

## Test Strategy

### TypeScript Tests
- **Framework:** `bun:test` (consistent with existing `test/provider/provider.test.ts`)
- **Approach:** Unit tests + one real local HTTP server test (using `Bun.serve`) to validate the provider sends the right headers and parses streaming SSE with `delta.reasoning_content`
- **File:** `test/provider/web-provider.test.ts`
- **Run:** `bun test test/provider/web-provider.test.ts`

### Python Tests
- **Framework:** `unittest` (stdlib, no extra deps needed; consistent with `pyproject.toml` minimalism)
- **Approach:** Pure unit tests with `unittest.mock.patch` for filesystem/env isolation
- **Files:**
  - `scripts/web-proxy/tests/test_base.py`
  - `scripts/web-proxy/tests/test_sse.py`
  - `scripts/web-proxy/tests/test_tools.py`
  - `scripts/web-proxy/tests/test_auth.py`
- **Run (from `scripts/web-proxy/`):** `python -m pytest tests/` or `python -m unittest discover tests/`

---

## Environment

| Dependency | Version |
|---|---|
| Bun | ≥ 1.1 |
| Python | ≥ 3.11 (matches `pyproject.toml`) |
| `@ai-sdk/alibaba` | Installed in workspace |
| pytest (optional) | If available; falls back to `unittest` |

---

## Entry / Exit Criteria

### Entry
- Branch `feat/unified-web-proxy` is checked out
- `bun install` has been run (TypeScript deps present)
- `scripts/web-proxy/web_proxy/` modules are importable (`python -c "import web_proxy.base"` succeeds from `scripts/web-proxy/`)

### Exit
- All TypeScript test cases: PASS
- All Python test cases: PASS
- No tests skipped due to missing imports or configuration

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@ai-sdk/alibaba` API surface changes | Tests assert on stable properties (`modelId`, `provider`, `specificationVersion`) |
| `resolveModel` requires live DB/config | Tested via provider contract tests, not full integration |
| Python import path issues | `sys.path.insert(0, ...)` added to each test file for portability |
| `load_token_file` writes/reads `~/.config/quark/` | All file tests use `tempfile.TemporaryDirectory` + `patch("web_proxy.auth.CONFIG_DIR", ...)` |

---

## Schedule

| Phase | Effort |
|---|---|
| Test writing (this phase) | Done |
| First run / triage | ~30 min |
| Fix any import/env issues | ~1 h |
| CI integration | ~30 min |
