# Copilot Reasoning `item.id` Rewrite

Why thinking-enabled Copilot streams crashed with
`undefined is not an object (evaluating 'activeReasoningPart.summaryParts')`,
and what the fix in `src/provider/copilot-fetch.ts` actually does.

## Scope

Applies to:
- Provider: GitHub Copilot (`api.githubcopilot.com`)
- Endpoint: `POST /responses` (OpenAI Responses API shape)
- SDK: `@ai-sdk/openai` via `createOpenAI({ name: "copilot" })`
- Models: reasoning-capable OpenAI-family models (e.g. `gpt-5.3-codex`)

Not applicable to Copilot's Anthropic-compatible `/v1/messages`
(separate code path, different event shape).

## What `item.id` is

The Responses API streams a sequence of SSE events. The model's output
is a list of **output items** — each item is one "chunk of work" (a
message, a function call, or an internal reasoning step). Items are
delivered through a lifecycle of events:

```
response.output_item.added        { output_index, item: { id, type, ... } }
  ...deltas for that item...
response.output_item.done         { output_index, item: { id, type, ... } }
```

Two fields identify an item:

- `output_index` — ordinal position in the model's output list (0, 1, 2, …).
- `item.id` — a string token assigned by the server (e.g. `rs_abc123`).

For **reasoning** items, the API may also stream summary text of the
model's scratchpad:

```
response.reasoning_summary_part.added    { output_index, item_id, summary_index }
response.reasoning_summary_text.delta    { output_index, item_id, summary_index, delta }
response.reasoning_summary_text.done     { output_index, item_id, summary_index }
response.reasoning_summary_part.done     { output_index, item_id, summary_index }
```

Both correlation keys — `output_index` and `item_id` — are present on
these events, but the AI SDK historically keyed internal state by
`item_id`.

## The assumption `@ai-sdk/openai` makes

When `response.output_item.added` arrives with `item.type === "reasoning"`,
the SDK records an entry in a per-stream dictionary
(`dist/index.js:5305`):

```js
activeReasoning[value.item.id] = {
  encryptedContent: value.item.encrypted_content,
  summaryParts: { 0: "active" },
}
```

Every subsequent event for that reasoning item — `summary_part.added`,
`summary_text.delta`, `summary_text.done`, `summary_part.done`, and the
final `output_item.done` — is looked up with the same id
(`dist/index.js:5596`):

```js
const activeReasoningPart = activeReasoning[value.item.id]
const summaryPartIndices = Object.entries(
  activeReasoningPart.summaryParts    // ← assumes entry exists
).filter(...)
```

There is no guard: if the lookup misses, the next line throws
`undefined is not an object`.

**Implicit assumption:** the server sends the same `item.id` on every
event of a given item's lifecycle.

For the stock OpenAI API this holds. Reasoning ids look like `rs_<stable>`
and persist across all events of the same item.

## Why Copilot breaks the assumption

Copilot's `/responses` proxy **rotates `item.id` on every event**. The
id is not a stable identifier — it is an opaque (encrypted-looking) token
regenerated per frame.

Observed directly via mitmproxy on a single stream for one reasoning item:

```
response.output_item.added   reasoning   item.id = "2d7f9YEg…"
response.output_item.done    reasoning   item.id = "LfQfK21i…"   ← different
```

Both events describe the same reasoning item — `output_index` is the
same across both. Only `item.id` changes.

Consequence in the SDK:

1. `added` fires → SDK saves state under the key `"2d7f9YEg…"`.
2. `done` fires → SDK looks up `activeReasoning["LfQfK21i…"]` → `undefined`.
3. SDK reads `.summaryParts` on `undefined` → crash.

This is a known Copilot characteristic. The opencode project forked
`@ai-sdk/openai` for exactly this reason; their source carries the
comment
([`openai-responses-language-model.ts:836`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts)):

```ts
// Track reasoning by output_index instead of item_id
// GitHub Copilot rotates encrypted item IDs on every event
```

Function-call streaming has the same issue (argument deltas cannot be
correlated by `item_id`); the working pattern across clients is to
correlate by `output_index` instead.

## What `item.id` is actually used for

Two consumers downstream of the stream parser:

1. **Internal state correlation inside the SDK** — the dictionary lookup
   described above. This is what crashes on Copilot.
2. **Provider metadata on emitted events** — the SDK attaches
   `providerMetadata.openai.itemId` to outgoing `reasoning-start` /
   `reasoning-delta` / `reasoning-end` events so downstream consumers
   can group chunks that belong to the same reasoning item.

Both uses require id stability within a stream. Neither cares about
cross-request stability (a different request produces a different id).

## The fix: rewrite the stream at the fetch boundary

Located in `src/provider/copilot-fetch.ts`:

```
rewriteCopilotResponsesStream(body) — TransformStream on SSE bytes
```

Activation guard (only `/responses` SSE responses through Copilot):

```ts
if (contentType.includes("text/event-stream") &&
    url.includes("/responses") &&
    response.body) {
  return new Response(rewriteCopilotResponsesStream(response.body), ...)
}
```

Logic per SSE line:

- Parse `data: {json}` lines; leave everything else untouched
  (comments, keepalives, `[DONE]`, headers, blank frames).
- Maintain `canonicalIds: Map<output_index, string>`.
- On `response.output_item.added` with `item.type === "reasoning"`:
  record `canonicalIds.set(output_index, item.id)`. The `added` id
  becomes the canonical id for that slot — no rewrite needed, the SDK
  sees it first and stores state under it.
- On `response.output_item.done` with `item.type === "reasoning"`:
  overwrite `item.id` with the canonical id for the same
  `output_index`, so the SDK's lookup finds the entry it created on
  `added`.
- On any `response.reasoning_summary_*` event: overwrite `item_id`
  the same way. (Not observed in current Copilot streams — see the
  "What is and isn't in Copilot's stream today" section — but cheap
  to handle preemptively.)

The SDK sees a normal OpenAI stream with a stable id per reasoning
item. No SDK changes, no fork, no patch-package.

## What is and isn't in Copilot's stream today

Empirically captured from `gpt-5.3-codex` at
`reasoning: { effort: "xhigh", summary: "auto" }`, on a prompt that
produced 326 reasoning tokens server-side:

Present:
- `response.output_item.added` — reasoning, `summary: []`,
  `encrypted_content: ""`, `content: null`
- `response.output_item.done` — reasoning, same empty fields,
  **different `item.id`**
- Many `response.output_text.delta` for the final answer

Absent (despite `summary: "auto"` requested and echoed back by the
server as `summary: "detailed"`):
- Any `response.reasoning_summary_part.*`
- Any `response.reasoning_summary_text.*`

Interpretation: Copilot's proxy currently does not forward reasoning
summary content to clients. The model reasons, but the chain-of-thought
text never leaves the proxy. This matches user reports in
[opencode#6864](https://github.com/anomalyco/opencode/issues/6864).

The rewrite therefore fixes the crash today; it does not make
reasoning content visible because Copilot sends none. If Copilot ever
begins forwarding summary events, the rewrite is already set up to
normalize their `item_id` fields and the SDK will emit the usual
`reasoning-delta` events — no further changes required in Quark.

## Why this layer (fetch boundary) and not another

Four options were weighed:

1. **Fork `@ai-sdk/openai`** (opencode's path). ~1770 lines owned
   forever; manual port of every upstream feature and bug fix. Chosen
   only if Copilot diverges in many more ways than just id rotation.
2. **`patch-package` the SDK's missing `if (activeReasoningPart)`
   guard.** Smallest diff, but patches minified `dist/index.js`;
   breaks silently on version bumps. Prevents the crash but drops any
   future reasoning content (no state reconstruction possible).
3. **Stream rewrite at the fetch boundary** (this fix). ~60 lines in
   one file. Immune to SDK refactors as long as Copilot keeps the
   OpenAI Responses event shape.
4. **Ignore reasoning entirely** (disable thinking for Copilot OpenAI
   models). Regresses a user-facing feature; user still pays for
   reasoning tokens server-side with nothing shown.

(3) is the smallest durable fix. The rewrite runs before the SDK
parses anything, so every change the SDK may make to its parsing
internals continues to work.

## Related fixes shipped alongside (same session)

Fixing the crash surfaced two pre-existing bugs in the thinking
toggle that had been masked by the stream crash:

- **`reasoning.effort` was nested, not flat.**
  `src/provider/thinking.ts::normalizeEffort` emitted
  `{ openai: { reasoning: { effort } } }`. The SDK's Responses schema
  expects `{ openai: { reasoningEffort } }`. The nested shape passed
  no validation and was silently dropped — `effort` never reached the
  wire. Fixed to the flat form.
- **Ctrl+T did not propagate effort into the normalizer.**
  `ThinkingNormalizer`'s internal `config.effort` was only ever set
  to the constructor default (`"medium"`). The UI chip cycled through
  levels but the request body always said `medium`. Ctrl+T now calls
  `getThinkingNormalizer().configure({ effort: level })`, and the
  normalizer singleton preserves config across model switches.

Together these three fixes make the toggle match the wire and the
wire not crash the client.

## How to verify

Quick (no proxy, in-process): run the TUI, `/model copilot/<reasoning-model>`,
press Ctrl+T until the chip shows any non-`none` level, send a prompt
that will produce reasoning. The stream should render to completion
without a Provider Error popup.

Wire-level (mitmproxy): capture a `/responses` stream. On the captured
bytes, `response.output_item.added` and `response.output_item.done`
reasoning events will have *different* `item.id` values — Copilot's
behavior is unchanged, the rewrite happens between the socket and the
SDK. To confirm the rewrite, log inside `rewriteCopilotResponsesStream`
the before/after `item.id` per `output_item.done` reasoning event.
