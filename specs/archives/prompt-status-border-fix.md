---
title: TUI Prompt Status Border Fix
date_created: 2026-06-05
date_modified: 2026-06-05
revision: 3
history:
  - 2026-06-05: Initial implementation record
  - 2026-06-05: Reworked fix to use the native prompt border and move status content inside the box
  - 2026-06-05: Restored status-on-border design with exact-width top border composition
status: done
---

## Problem

The prompt input box showed a visual "hole" in its top border where the model
name was rendered.

```
╭── 4.1% of 1M ───────────────── opencode/kimi-k2.6─ ──╮
                                  ^ status text replaces border cells
```

The first fix treated this as a missing separator character, but the screenshot
showed the deeper issue: the component removed the native top border and rebuilt
that border from a clipped flex filler plus several adjacent `<text>` nodes.
That made the top row fragile across model names, thinking states, and terminal
widths.

Root cause: the prompt top border was not composed from the actual prompt width.
It relied on a long filler string being clipped by flex layout.

## Implementation

Changes in `src/tui/components/prompt.tsx`:

1. Kept the status/model text on the top border line.
2. Added an explicit rendered width prop from `App` to `Prompt`.
3. Replaced the clipped 300-character filler with exact dash-count composition
   from the prompt width.
4. Kept the body box border as left/right/bottom so the top row remains the
   custom status border.
5. Added a renderer-backed regression test:
   `test/tui/prompt-border.test.ts`.

## Key Decisions

1. **Preserve the original status-on-border design.** The top border remains
   the compact status line:
   `╭── 4.1% of 1M ─── opencode/kimi-k2.6 ──╮`.
2. **Compute the filler from width.** The border no longer depends on overflow
   clipping to hide excess `─` characters.
3. **Verify rendered terminal output.** The regression test checks the captured
   OpenTUI frame, not intermediate strings.

## Acceptance Criteria

- [x] Status line border is unbroken when thinking effort is off.
- [x] Status line border is unbroken when thinking effort is on.
- [x] Context percentage and model name are on the top border line.
- [x] No clipped repeated-dash filler is needed for the prompt border.

## Verification

- `bun test test/tui/prompt-border.test.ts` — passes.
- `npm run typecheck` — passes.
- Manual TUI smoke test — prompt renders with a continuous native top border.
