# Context Management Strategy: Compaction vs Handoff

**Status:** Open — no decision made  
**Thread:** https://ampcode.com/threads/T-019d0f4f-31d0-7590-9db2-5a05bda2ba36

---

## Problem

As conversation threads grow, context accumulates from conversation turns, tool outputs, and observation history. ~65% of enterprise agent failures in 2025 were attributed to **context drift** — the model's reasoning silently diverging from the original task as older context gets de-prioritized. We need a strategy to manage this.

---

## Option A: Anchored Iterative Compaction (Factory-style)

Keep threads running long. When context reaches ~70% capacity, compress only the **evicted span** (the messages being pushed out) and merge into a persistent **anchor state**.

### Anchor structure
```
{
  intent:       "what the user is trying to accomplish",
  changes_made: "files modified, code written so far",
  decisions:    "architectural choices, rejected alternatives",
  next_steps:   "what remains to be done"
}
```

### How it works
1. Thread runs until context hits ~70% threshold
2. Identify the oldest N messages to evict
3. Summarize **only** the evicted span (not the full history)
4. Merge that summary into the existing anchor
5. Drop the evicted messages, keep anchor + recent messages
6. Continue in the same thread

### Pros
- **Transparent** — user doesn't manage context manually
- **Incremental** — each compression cycle only risks losing info from one small span
- **Continuous** — single thread identity, no context switching
- **Higher accuracy** — Factory scored 4.04 vs Anthropic's 3.74 and OpenAI's 3.43 for preserving technical details across compression cycles

### Cons
- Still lossy — details degrade over many compression cycles
- Requires tuning the eviction threshold and anchor merge logic
- Anchor can grow stale or accumulate noise over many iterations
- More complex to implement (trigger logic, summarization, merging)

---

## Option B: Handoff (Amp-style)

Reject compaction entirely. Keep threads short and focused. When a thread's purpose is fulfilled or context is getting large, start a **new thread** with a goal-directed extraction from the current one.

### How it works
1. User triggers handoff with a goal (e.g., "now implement phase two")
2. The model (already has the full conversation in context) generates:
   - A crafted **prompt** summarizing relevant context for the next task
   - A list of **relevant file paths** to include
3. User reviews/edits the draft prompt
4. New thread starts fresh with that prompt

### Pros
- **Full fidelity** — no lossy compression within a thread
- **Intentionally selective** — only carries forward what matters for the next task
- **Simple** — no compression algorithms, thresholds, or anchor merging
- **User control** — the handoff draft is editable before sending

### Cons
- Requires **user discipline** — must keep threads short, must trigger handoff manually
- Context from old threads is gone unless explicitly carried over
- Thread switching has cognitive overhead
- Quality depends on the handoff goal being well-specified

---

## Key Dimensions for Decision

| Dimension | Compaction (Option A) | Handoff (Option B) |
|---|---|---|
| User effort | Automatic | Manual |
| Context fidelity | Degrades over cycles | Full within thread |
| Long sessions | Graceful degradation | Forces thread switch |
| Implementation complexity | High (trigger, summarize, merge) | Low (one-shot extraction) |
| Drift risk | Managed by compression quality | Managed by thread brevity |
| Thread identity | One continuous thread | Many short threads |
| Philosophy | "Make long threads survive" | "Long threads shouldn't exist" |

---

## Open Questions

- What is our expected average session length? If most tasks complete in <20 turns, handoff may be sufficient.
- Do we have use cases requiring very long unbroken sessions (e.g., multi-file refactors)?
- Could we support **both** — handoff as the primary mechanism, with compaction as a fallback safety net?
- If compaction: do we use the same model or a dedicated fine-tuned compaction model (Cognition's approach)?
- What is the token budget for our target model, and at what utilization does quality degrade?
