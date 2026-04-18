# Web-Proxy Profiling Experiment

## Goal

Identify **where latency is introduced** in the web-proxy pipeline compared to using the provider web UIs directly. Measure each stage independently so we can isolate the bottleneck.

---

## Pipeline Stages

Every request flows through these stages. Each is a profiling point:

```
[Stage 0]  Quark TS → HTTP POST
[Stage 1]  Proxy receives request, parses JSON, resolves provider
[Stage 2]  Provider setup (create chat, build prompt, tool preamble)
[Stage 3]  Upstream HTTP connection established (TLS handshake, first byte sent)
[Stage 4]  Time to first upstream SSE event (TTFB from provider)
[Stage 5]  Upstream SSE chunk → abstract event conversion
[Stage 6]  Abstract event → OpenAI SSE serialization + wfile.write + flush
[Stage 7]  Inter-chunk gaps (max, avg, p95, p99)
[Stage 8]  Total stream duration
```

---

## Experiment 1: Provider-Level Timing (Python-side)

### What it measures

Instrument `server.py` and each provider to emit structured timing logs at each pipeline boundary.

### Metrics collected per request

| Metric | Description |
|--------|-------------|
| `t_request_parse` | Time to parse incoming JSON body |
| `t_provider_resolve` | Time to resolve provider from model string |
| `t_provider_setup` | Time for provider setup (create_chat, auth headers, etc.) |
| `t_upstream_connect` | Time from HTTP POST to upstream until first `iter_lines` byte |
| `t_first_event` | Time from `stream()` call to first yielded event |
| `t_first_text` | Time from `stream()` call to first `TextDelta` |
| `t_chunk_gaps` | Array of (timestamp, gap_ms) for every consecutive event pair |
| `t_serialization` | Cumulative time spent in `sse.py` serialization |
| `t_write_flush` | Cumulative time spent in `wfile.write()` + `flush()` |
| `t_tool_parse` | Cumulative time in `ToolCallParser.feed()` (when tools present) |
| `t_total` | Total request duration |
| `event_count` | Number of SSE events emitted |
| `bytes_total` | Total bytes written to client |

### Implementation

Add a `ProfilingContext` dataclass that accumulates timings. The profiling wrapper wraps `provider.stream()` to intercept and timestamp each event. Results are written as a JSON line to a log file.

---

## Experiment 2: Direct Provider Baseline (Bypass Proxy)

### What it measures

Call each provider's `_raw_stream_http()` / `_stream_query()` directly from a standalone script — no HTTP server, no SSE conversion, no proxy overhead. This gives us the **provider-native speed** as a baseline.

### Metrics collected

| Metric | Description |
|--------|-------------|
| `t_setup` | Time for auth + create_chat (if applicable) |
| `t_first_byte` | Time from HTTP POST to first SSE line from upstream |
| `t_first_content` | Time to first non-empty content token |
| `t_chunk_gaps` | Inter-chunk timing |
| `t_total` | Total stream duration |
| `tokens_total` | Approximate token count (chars / 4) |
| `throughput` | Tokens per second |

### Purpose

Compare with Experiment 1 to isolate: **how much latency does the proxy layer itself add?**

---

## Experiment 3: HTTP Server Overhead

### What it measures

Use `curl` to hit the proxy endpoint and measure:

1. **TCP connect time** (`curl --write-out '%{time_connect}'`)
2. **Time to first byte** (`%{time_starttransfer}`)
3. **Total time** (`%{time_total}`)
4. **Content received timing** (via `--trace-time`)

### Comparison

Run the same prompt through:
- `curl → proxy → upstream` (full pipeline)
- Direct `requests.post()` to upstream (Experiment 2)
- Browser DevTools Network tab on the web UI

This isolates the HTTP server overhead (Python `http.server`, sync I/O, buffering).

---

## Experiment 4: Buffering & Flushing Analysis

### What it measures

Specific investigation of buffering at each layer:

1. **Python `wfile` buffering** — Does `wfile.flush()` actually push bytes to the socket, or is there OS-level buffering? Test with `TCP_NODELAY`.
2. **`requests.iter_lines()` buffering** — Compare `iter_lines(chunk_size=1)` vs default vs `iter_content(chunk_size=1)` to see if line-buffering is adding delay.
3. **`curl_cffi.iter_lines()` buffering** — Same analysis for Claude/Perplexity providers.
4. **SSE JSON serialization cost** — Profile `json.dumps()` per chunk (should be negligible but verify).

---

## Experiment 5: Provider-Specific Investigations

### Qwen

| Suspect | Test |
|---------|------|
| `_create_chat()` round-trip | Time this call in isolation — it's blocking and happens before any streaming |
| `_delete_chat()` | Runs in the finally block — doesn't block streaming but adds to total |
| `iter_lines(decode_unicode=True)` | Compare with `iter_content()` for raw byte streaming |
| Phase parsing logic | How much time is spent in the phase/reasoning/content branching? |

### Claude

| Suspect | Test |
|---------|------|
| `curl_cffi` TLS setup | Time `impersonate="safari17_0"` — TLS fingerprint negotiation |
| `_create_conversation()` | Extra round-trip before streaming |
| Cookie auth overhead | Large cookie header serialization |

### Perplexity

| Suspect | Test |
|---------|------|
| Block-based parsing | The `blocks[].markdown_block.chunks` nested extraction |
| Duplicate detection (`prev_text`) | String prefix comparison on growing text |

### Meta

| Suspect | Test |
|---------|------|
| `_warmup()` call | Blocking GraphQL call before actual message |
| Non-streaming response | Meta returns full response body, parsed line-by-line (not true SSE streaming) |
| Section-based extraction | Nested JSON traversal per line |

---

## Output Format

All experiments write JSON Lines to `logs/proxy-profile/`:

```
logs/proxy-profile/
  experiment-1-{provider}-{timestamp}.jsonl    # Per-request timing
  experiment-2-{provider}-{timestamp}.jsonl    # Direct baseline
  experiment-3-curl-{timestamp}.jsonl          # curl measurements
  summary-{timestamp}.json                     # Aggregated comparison
```

Each JSONL entry:

```json
{
  "experiment": 1,
  "provider": "qwen",
  "model": "qwen3-max",
  "prompt_preview": "first 50 chars...",
  "timestamp": "2026-04-11T10:00:00Z",
  "metrics": {
    "t_request_parse_ms": 0.5,
    "t_provider_resolve_ms": 0.01,
    "t_provider_setup_ms": 450,
    "t_first_event_ms": 1200,
    "t_first_text_ms": 1800,
    "t_total_ms": 8500,
    "chunk_gaps_ms": { "min": 5, "max": 800, "avg": 45, "p95": 120, "p99": 350 },
    "event_count": 150,
    "bytes_total": 12000,
    "tokens_approx": 3000,
    "throughput_tps": 352
  }
}
```

---

## Test Prompts

Use consistent prompts across all experiments for apples-to-apples comparison:

| ID | Prompt | Purpose |
|----|--------|---------|
| `short` | `"What is 2+2? Answer in one word."` | Minimum latency (isolates setup overhead) |
| `medium` | `"Explain the difference between TCP and UDP in 3 paragraphs."` | Typical response length |
| `long` | `"Write a Python implementation of a basic HTTP server with routing, explain each part."` | Long streaming response |
| `tools` | Medium prompt + 3 tool definitions | Tool preamble + XML parsing overhead |
| `reasoning` | `"Think step by step: what is 127 * 43?"` | Reasoning token path |

Each prompt runs **3 times** per provider to account for variance.

---

## Analysis Script

A `profile_analyze.py` reads all JSONL files and produces:

1. **Per-provider breakdown** — Where each provider spends time (stacked bar chart data)
2. **Proxy overhead** — Experiment 1 total minus Experiment 2 total = proxy cost
3. **Bottleneck identification** — Which stage has the largest delta vs. web UI
4. **Recommendations** — Automated suggestions based on findings:
   - If `t_provider_setup > 500ms` → "Pool/reuse chat sessions"
   - If `chunk_gap_p95 > 200ms` → "Buffering issue in iter_lines or wfile"
   - If `t_serialization > 5% of total` → "SSE serialization is hot"
   - If `t_write_flush > 10% of total` → "Enable TCP_NODELAY or switch to async server"

---

## Implementation Plan

| Step | File | Description |
|------|------|-------------|
| 1 | `web_proxy/profiling.py` | `ProfilingContext` + timing utilities + JSONL writer |
| 2 | `web_proxy/server.py` | Wrap `_handle_stream` with profiling instrumentation |
| 3 | `web_proxy/base.py` | Add timing hooks around `stream()` yield points |
| 4 | `scripts/web-proxy/profile_baseline.py` | Experiment 2 — direct provider calls |
| 5 | `scripts/web-proxy/profile_curl.sh` | Experiment 3 — curl timing measurements |
| 6 | `scripts/web-proxy/profile_analyze.py` | Analysis + summary generation |

Profiling is **opt-in**: enabled via `WEB_PROXY_PROFILE=1` env var. Zero overhead when disabled.
