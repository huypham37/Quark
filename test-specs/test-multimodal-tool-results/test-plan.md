# Test Plan — Multi-Modal Tool Results (Images in Tool Output Pipeline)

## Objective

Verify that the multi-modal tool result feature — allowing tools to return
`ToolResultContentPart[]` (text + image-data) alongside the existing plain
`string` output — works correctly end-to-end across all five affected layers:

1. **Type system** (`ToolResult`, `ToolResultContentPart`, `ToolPartData`)
2. **Persistence** (`extractOutput` in `processor.ts`)
3. **LLM replay** (`toModelMessages` in `message.ts`)
4. **Model output** (`toModelOutput` in `prompt.ts`)
5. **Compaction pruning** (`anchored.ts`)

---

## Scope

### In Scope

| Layer | File | What changes |
|---|---|---|
| Tool contract | `src/tool/tool.ts` | `ToolResult.output: string → string \| ToolResultContentPart[]`; new `ToolResultContentPart` union type |
| Part persistence | `src/session/message.ts` | `ToolPartData.contentParts?: ToolResultContentPart[]` |
| LLM reconstruction | `src/session/message.ts` `toModelMessages()` | Emits `{ type: "content", value: [...] }` when `contentParts` is present |
| Stream processing | `src/session/processor.ts` `extractOutput()` | Extracts text-only from ContentPart[], stores full parts in `contentParts` |
| Model output | `src/session/prompt.ts` `toModelOutput()` | Returns `{ type: "content", value: [...] }` for array output |
| Compaction | `src/session/methods/anchored.ts` | Clears `contentParts` when pruning terminal tool parts |

### Out of Scope

- TUI rendering of image parts (separate UI concern)
- New tool implementations that return images (e.g. `screenshot` tool)
- AI SDK version compatibility beyond the existing `ContentPart` contract
- Streaming of image data mid-call (images are returned as completed results)

---

## Test Strategy

**Approach:** Unit tests — pure function testing with manually constructed
`MessageRow` / `PartRow` fixture data. No I/O, no live LLM calls.

**Technique:** Red-Green-Refactor (TDD).

- Tests are written first (red) referencing types and fields that do not exist yet.
- Each test will fail at import/compile time or at runtime until the corresponding
  implementation is merged.
- Tests turn green as the implementation lands layer by layer.

**Test location:** `test/session/multimodal-tool-result.test.ts`

**Runner:** `bun test`

---

## Test Groups

### Group 1 — `toModelMessages` with content parts (6 tests)

Covers the LLM message reconstruction path. The most critical layer because
it determines what the model receives as tool context.

| ID | Scenario | Priority |
|---|---|---|
| G1-T1 | String output → unchanged `{ type: "text", value }` (backward compat) | high |
| G1-T2 | `contentParts` present → `{ type: "content", value: [...] }` | high |
| G1-T3 | Mixed text + image contentParts faithfully forwarded | high |
| G1-T4 | Text-only contentParts still uses content-type branch | medium |
| G1-T5 | Multiple tool calls in one turn — string and content-parts routed independently | high |
| G1-T6 | Error tool result with contentParts → error text path, contentParts ignored | medium |

### Group 2 — `extractOutput` persistence contract (4 tests)

Validates the shape of `ToolPartData` written to the JSONL store after
the processor handles a multi-modal tool result.

| ID | Scenario | Priority |
|---|---|---|
| G2-T7 | String output stored as-is, no `contentParts` field | high |
| G2-T8 | ContentPart[] — `.output` = text-only extraction; `.contentParts` = full array | high |
| G2-T9 | Image-only ContentPart[] — `.output` = empty string | medium |
| G2-T10 | `ToolResultContentPart` type discriminant exhaustiveness | low |

### Group 3 — Compaction pruning (4 tests)

Validates that images are removed from the compacted session — ensuring that
multi-modal data does not bloat retained context or survive compaction
boundaries.

| ID | Scenario | Priority |
|---|---|---|
| G3-T11 | Completed tool part — `output` replaced AND `contentParts` cleared | high |
| G3-T12 | Pending/running tool parts NOT pruned (status guard) | medium |
| G3-T13 | Pruned part (no contentParts) → `toModelMessages` falls back to text-type | high |
| G3-T14 | Error-status tool part with contentParts also pruned | medium |

### Group 4 — `ToolResult` type contract (3 tests)

Ensures the new union type is structurally correct and backward-compatible
at both the TypeScript level and the runtime discriminant level.

| ID | Scenario | Priority |
|---|---|---|
| G4-T15 | `string` still satisfies `ToolResult.output` | high |
| G4-T16 | `ToolResultContentPart[]` satisfies `ToolResult.output` | high |
| G4-T17 | Runtime `Array.isArray` correctly discriminates the union | medium |

---

## Environment

- Runtime: Bun (≥ 1.1)
- Test framework: `bun:test` (Jest-compatible)
- No external dependencies beyond the existing project

---

## Entry Criteria

- `test/session/multimodal-tool-result.test.ts` committed and all tests are **red**
  (failing either at type-check or at runtime)
- Implementation branch created from current `main`

## Exit Criteria

- All 17 tests pass (`bun test test/session/multimodal-tool-result.test.ts`)
- Existing test suite unaffected (`bun test` — zero regressions)
- `ToolResultContentPart` exported from `src/tool/tool.ts`
- `ToolPartData.contentParts` declared in `src/session/message.ts`

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI SDK `ToolModelMessage` does not support `{ type: "content" }` output | Medium | High | Check AI SDK type definitions before implementation; fall back to inline base64 image if needed |
| Compaction misses the `contentParts` clear in one branch | Medium | Medium | G3-T14 covers the error-status path explicitly |
| `toModelOutput` in `prompt.ts` not updated alongside `toModelMessages` | Low | High | Integration test (G1-T2) exercises the full round-trip |
| Backward compat break — existing string tools fail | Low | High | G1-T1 and G4-T15 explicitly guard the string path |
