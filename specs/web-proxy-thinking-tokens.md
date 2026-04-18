# Web-Proxy Thinking Token Formats

## Overview

This document records the raw SSE event structures emitted by each provider/model when generating reasoning (thinking) tokens. Captured via `scripts/web-proxy/profile_thinking_tokens.py` on 2026-04-11.

Prompt used: `"Think step by step: what is 127 * 43? Show your reasoning."`

---

## Qwen Models

All Qwen models use the `chat.qwen.ai` webapp API (`POST /api/v2/chat/completions`).
Thinking is enabled via `feature_config.thinking_enabled = true` with `output_schema = "phase"`.

### Common SSE Wire Format

Every SSE line is `data:{JSON}`. The JSON has this shape:

```json
{
  "choices": [{
    "delta": {
      "role": "assistant",
      "content": "...",
      "phase": "think" | "thinking_summary" | "answer",
      "status": "typing" | "finished",
      "extra": { ... },              // only qwen3.6-plus thinking_summary
      "reasoning_content": "...",    // NOT used by webapp API (always absent)
      "function_call": { ... }       // only when native FC is triggered
    },
    "finish_reason": null | "stop"
  }]
}
```

Key finding: **None of the Qwen webapp models use `delta.reasoning_content`**.
Thinking tokens are delivered via `delta.phase` + `delta.content`.
The `reasoning_content` field exists in the code path as a fallback for the Qwen API (non-webapp) but was never observed in any webapp SSE event.

---

### qwen3-max

**Thinking format:** Phase-based, `phase="think"` with streaming content tokens.

| Field | Value |
|---|---|
| Thinking phase | `phase="think"` |
| Thinking content | `delta.content` (streamed incrementally) |
| Phase transition | `think` → (status=`finished`) → `answer` |
| `reasoning_content` | Never present |
| `extra` | Never present |
| Delta keys | `['role', 'content', 'phase', 'status']` |

**Lifecycle:**

```
Event 0: { "response.created": { "chat_id": "..." } }          ← no choices
Event 1: phase="think"  status="typing"  content="Okay, so"     ← thinking starts
Event 2: phase="think"  status="typing"  content=" I need to"
  ...    (201 think events, ~19s)
Event N: phase="think"  status="finished" content=""             ← thinking ends
Event N+1: phase="answer" status="typing" content="To calculate" ← answer starts
  ...    (69 answer events)
Event N+M: phase="answer" status="finished" content=""           ← stream ends
```

**Timing (observed):**
- First event: 617ms
- First think: 1,127ms
- First answer: 20,343ms (thinking duration: ~19.2s)
- Total: 21,152ms
- Think events: ~201, Answer events: ~70

---

### qwen3-coder-plus

**Thinking format:** Identical to qwen3-max — `phase="think"` with streaming content.

| Field | Value |
|---|---|
| Thinking phase | `phase="think"` |
| Thinking content | `delta.content` (streamed incrementally) |
| Phase transition | `think` → (status=`finished`) → `answer` |
| `reasoning_content` | Never present |
| `extra` | Never present |
| Delta keys | `['role', 'content', 'phase', 'status']` |

**Lifecycle:** Same as qwen3-max.

**Timing (observed):**
- First event: 537ms
- First think: 946ms
- First answer: 17,962ms (thinking duration: ~17s)
- Total: 18,868ms
- Think events: ~177, Answer events: ~71

---

### qwen3.6-plus

**Thinking format:** Different — uses `phase="thinking_summary"` with structured `extra` field.
Does NOT stream raw thinking tokens. Instead emits a **summary** of thoughts.

| Field | Value |
|---|---|
| Thinking phase | `phase="thinking_summary"` |
| Thinking content | `delta.extra.summary_thought.content[]` (array of summary paragraphs) |
| Thinking titles | `delta.extra.summary_title.content[]` (array of summary titles) |
| `delta.content` | Empty string during thinking_summary phase |
| Phase transition | `thinking_summary` → (status=`finished`) → `answer` |
| `reasoning_content` | Never present |
| Delta keys (thinking) | `['role', 'content', 'phase', 'extra', 'status']` |
| Delta keys (answer) | `['role', 'content', 'phase', 'status']` |

**Lifecycle:**

```
Event 0: { "response.created": { "chat_id": "..." } }          ← no choices
Event 1: phase="thinking_summary" status="typing"               ← summary starts
         content=""
         extra.summary_title.content: ["Breaking down the multiplication..."]
         extra.summary_thought.content: ["I recognize that 127..."]
Event 2: phase="thinking_summary" status="typing"               ← summary updates
         extra.summary_title.content: ["Breaking down...", "Calculating..."]
         extra.summary_thought.content: ["I recognize...", "I break down..."]
Event 3: phase="thinking_summary" status="typing"               ← (same content, repeated)
Event 4: phase="thinking_summary" status="finished"             ← summary ends
         (no extra field)
Event 5: phase="answer" status="typing" content="Let me"        ← answer starts
  ...    (100 answer events)
Event N: phase="answer" status="finished" content=""             ← stream ends
```

**`extra` field structure:**

```json
{
  "summary_title": {
    "content": [
      "Breaking down the multiplication using the distributive property",
      "Calculating the product through decomposition and verification"
    ]
  },
  "summary_thought": {
    "content": [
      "I recognize that 127 multiplied by 43 can be simplified...",
      "I break down the multiplication into manageable parts..."
    ]
  }
}
```

Note: The `extra.summary_thought.content` array grows incrementally — each
`thinking_summary` event includes all previous summaries plus new ones.
This is **cumulative**, not incremental.

**Timing (observed):**
- First event: 607ms
- First thinking_summary: 4,190ms (long pause — model does internal thinking before emitting summary)
- First answer: 8,165ms (thinking_summary duration: ~4s visible, but ~7.5s wall time)
- Total: 15,568ms
- thinking_summary events: 4 (just summaries, not token-by-token)
- Answer events: ~101

---

## Model Comparison (Qwen)

| Aspect | qwen3-max | qwen3-coder-plus | qwen3.6-plus |
|---|---|---|---|
| **Thinking phase** | `"think"` | `"think"` | `"thinking_summary"` |
| **Content delivery** | Streamed in `delta.content` | Streamed in `delta.content` | Structured in `delta.extra` |
| **Token-by-token** | ✅ Yes | ✅ Yes | ❌ No (summaries only) |
| **`reasoning_content`** | Never present | Never present | Never present |
| **`extra` field** | Never present | Never present | ✅ `summary_title` + `summary_thought` |
| **Thinking events** | ~201 | ~177 | ~4 |
| **Think → Answer gap** | Clear (`status=finished`) | Clear (`status=finished`) | Clear (`status=finished`) |
| **Think duration** | ~19.2s | ~17.0s | ~7.5s (internal) |

---

## Meta AI

**Auth:** `rd_challenge` + `ecto_1_sess` cookies (`META_RD_CHALLENGE`, `META_ECTO_SESS` env vars).

**Status:** ✅ Validated via experiment on 2026-04-13.

### Modes

Meta AI has three modes, selectable via the `mode` GraphQL variable:

| Mode | Variable Value | Description |
|---|---|---|
| **Instant** | `null` (omit or `"think_fast"`) | Default — answers immediately, no thinking |
| **Thinking** | `"think_hard"` | Extended reasoning with ThinkingStatus sections |
| **Create** | `"create"` | Image/video generation mode |

The `mode` variable is passed directly in the `sendMessageStream` subscription variables.

### Doc IDs (Relay Persisted Queries)

| Name | Doc ID | Usage |
|---|---|---|
| `useEctoSendMessageSubscription` | `af4c07d1fb42eb351dba31b5a299a819` | Single-send (full variable set) |
| `useEctoMultiSendSubscription` | `62fbc9b911a73008132a4f5333387703` | Multi-send / compare (minimal variables, also accepts `mode`) |
| Warmup | `e7f802582dbfed8e181b012e010993eb` | Conversation warmup |

Both send doc_ids accept `mode` and produce identical thinking output.

### Response Format

Meta AI uses GraphQL (`POST https://meta.ai/api/graphql`), not SSE. The response body contains `data:` prefixed lines (SSE-like), each with a JSON payload:

```json
{
  "data": {
    "sendMessageStream": {
      "__typename": "AssistantMessage",
      "streamingState": "STREAMING" | "DONE",
      "contentRenderer": {
        "unified_response": {
          "sections": [
            {
              "view_model": {
                "primitive": {
                  "__typename": "GenAIBotThinkingStatusPrimitive" | "GenAIMarkdownTextUXPrimitive" | "GenAICodeUXPrimitive" | "GenAILatexUXPrimitive",
                  ...
                }
              }
            }
          ]
        }
      }
    }
  }
}
```

### Thinking Events — GenAIBotThinkingStatusPrimitive

```json
{
  "__typename": "GenAIBotThinkingStatusPrimitive",
  "__isGenAIUXPrimitive": "GenAIBotThinkingStatusPrimitive",
  "is_in_progress": true | false,
  "thought_text": "Calculating 127 times 43",
  "title": "Calculating 127 times 43",
  "icon": null,
  "meta_search_apps": null,
  "target_secondary_screen_id": null,
  "target_secondary_screen_tab_id": null,
  "thought_duration_sec": null,
  "subagents_cot": null,
  "auto_close_secondary_screen": null,
  "show_answer_now": null
}
```

**All primitive keys (observed):**
`__typename`, `__isGenAIUXPrimitive`, `is_in_progress`, `icon`, `meta_search_apps`,
`target_secondary_screen_id`, `target_secondary_screen_tab_id`, `thought_duration_sec`,
`thought_text`, `subagents_cot`, `auto_close_secondary_screen`, `show_answer_now`, `title`

**Behavior:**
- `is_in_progress=true`: Thinking is ongoing
- `is_in_progress=false`: Thinking complete (empty `thought_text` and `title`)
- `thought_text` and `title` are typically the **same** high-level summary, NOT raw chain-of-thought
- The `thought_text` is NOT cumulative — it's a short status label that changes periodically
- `thought_duration_sec`, `subagents_cot`, `show_answer_now` were always `null` in testing

**Thinking text evolution (observed):**
The `thought_text`/`title` update infrequently (4 unique values across 614 thinking events):
```
Event   0: "Calculating 127 times 43"
Event 143: "Showing multiplication steps"
Event 333: "Completing multiplication calculation"
Event 546: "Calculating 127 times 43"
Event 627: "" (is_in_progress=false → thinking complete)
```

These are **status labels**, not detailed reasoning tokens. The actual chain-of-thought
is not exposed in the GraphQL response.

### Text Events — GenAIMarkdownTextUXPrimitive

```json
{
  "__typename": "GenAIMarkdownTextUXPrimitive",
  "text": "The full accumulated text so far..."
}
```

- `text` is **cumulative** — each event contains the full response so far
- The provider computes deltas: `text[len(prev_text):]` → `TextDelta`
- Other text section types: `GenAICodeUXPrimitive`, `GenAILatexUXPrimitive`

### Lifecycle (observed)

```
Events 0-614:   GenAIBotThinkingStatusPrimitive (is_in_progress=true)
                  thought_text updates ~4 times with status labels
Events 615+:    GenAIMarkdownTextUXPrimitive starts appearing
                  (coexists with ThinkingStatus in same events)
Event 627:      is_in_progress=false → thinking complete
Events 627-674: Both ThinkingStatus(done) + MarkdownText sections
Event 674:      streamingState="DONE"
```

**Timing (observed with `mode="think_hard"`):**
- Total events: ~675
- Thinking events: ~614 (with is_in_progress=true)
- Text events: ~62
- Response size: ~1MB

**Without thinking (`mode=null`):**
- Total events: ~69
- Text events: ~73
- No thinking sections at all
- Response size: ~200KB

### Key Differences from Qwen

| Aspect | Meta | Qwen |
|---|---|---|
| Protocol | GraphQL (not SSE) | SSE |
| Text delivery | Cumulative (full text each event) | Incremental (deltas) |
| Thinking activation | `mode: "think_hard"` variable | Always-on (model-dependent) |
| Thinking typename | `GenAIBotThinkingStatusPrimitive` | N/A (uses `phase` field) |
| Text typename | `GenAIMarkdownTextUXPrimitive` | N/A (uses `delta.content`) |
| Thinking content | Status labels (not raw CoT) | Raw thinking tokens or summaries |
| Thinking delivery | `thought_text` / `title` fields | `delta.content` or `delta.extra.summary_thought` |
| Stream termination | `streamingState: "DONE"` | `status: "finished"` + `phase: "answer"` |

---

## Impact on Provider Code

### Current qwen.py handling

The `_stream_chat()` method in `qwen.py` handles both think formats:

```python
# Phase-based thinking (both qwen3-max and qwen3-coder-plus)
if phase == "think" and status != "finished" and content:
    yield ReasoningDelta(text=content)

# Thinking summary (qwen3.6-plus) — currently SKIPPED
elif phase == "thinking_summary" and status != "finished":
    continue  # ← summary content in extra is discarded
```

**Issue:** qwen3.6-plus thinking summaries are silently discarded. The `extra.summary_thought.content` array is never read. If we want to expose thinking for qwen3.6-plus, we need to extract from `delta.extra.summary_thought.content` and emit as `ReasoningDelta`.

### Current meta.py handling (updated 2026-04-13)

All three issues from initial profiling have been resolved:

1. **Thinking mode activation** — `web/meta-ai-thinking` model passes `mode: "think_hard"`
   to the GraphQL variables. The `_raw_stream()` method detects `"thinking"` in the model
   name and sets the mode accordingly.

2. **Thought deduplication** — `thought_text` is only emitted as `ReasoningDelta` when it
   differs from the previous value (`prev_thought` tracking). This reduces ~614 duplicate
   events down to ~4 unique status labels.

3. **UTF-8 encoding fix** — Response body is decoded via `r.content.decode("utf-8")` instead
   of `r.text`, because `requests` defaults to Latin-1 when the `Content-Type` header lacks
   a charset parameter. This was garbling `×` and `–` characters in math responses.

4. **Text re-render handling** — When Meta re-renders text with different formatting (e.g.
   adding `{{IE}}` LaTeX wrappers), the new cumulative text doesn't start with `prev_text`.
   The provider now skips emitting in this case but updates `prev_text` as the new baseline
   for future deltas, preventing text duplication.

### Fallback for `reasoning_content`

```python
# This line exists but reasoning_content is never present in webapp SSE
if reasoning:  # reasoning = delta.get("reasoning_content", "")
    yield ReasoningDelta(text=reasoning)
```

This is dead code for webapp usage but may be relevant if the provider is ever adapted for the Qwen API (non-webapp) which does use `reasoning_content`.

---

## Recommendations

1. **qwen3.6-plus thinking summaries**: Consider extracting `delta.extra.summary_thought.content` to emit as `ReasoningDelta`. Currently these are discarded. The summaries are high-quality (model-generated abstractions of its reasoning) but arrive as cumulative arrays, not incremental deltas — requires diffing to emit only new content.

2. ~~**Meta thinking mode**~~: ✅ Done (2026-04-13). `web/meta-ai-thinking` model passes `mode: "think_hard"`, deduplicates `thought_text`, emits as `ReasoningDelta`.

3. **Meta typename updates**: The old typenames (`ThinkingStatusPrimitive`, `MarkdownTextPrimitive`) have been replaced with `GenAIBotThinkingStatusPrimitive` and `GenAIMarkdownTextUXPrimitive`. The current substring matching in meta.py still works. ✅ No action needed.

4. **`reasoning_content` field**: Can be safely deprioritized for webapp providers. The webapp API exclusively uses phase-based delivery. Only relevant if switching to the Qwen API SDK.
