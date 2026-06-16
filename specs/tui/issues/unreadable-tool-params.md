---
title: Unreadable Text on Light Terminals
date_created: 2026-06-05
date_modified: 2026-06-06
revision: 2
history:
  - 2026-06-05: Initial draft — focused on hardcoded dark teal #365A61 for tool params
  - 2026-06-06: Expanded scope. Root cause was OpenTUI's hardcoded white default text
    fg (RGBA(1,1,1,1)) which is invisible on light backgrounds. Fixed theme detection,
    explicit fg colors, syntax styles, and patched OpenTUI's internal default.
status: done
---

# Unreadable Text on Light Terminals

## Problem
On light terminal backgrounds, multiple categories of text were invisible or nearly invisible:
- **Tool names** (Read, Bash, Edit) — white on white
- **User messages** — white on white
- **Assistant markdown text** — white on white
- **Thinking indicator label** — white on white
- **Footer labels** (streaming status, steering) — white on white
- **Permission prompts** — white on white
- **Question prompt options** — white on white

The root cause was NOT a specific hardcoded color like `#365A61`. That color was already gone from the codebase. The real problem was deeper.

## Root Cause: OpenTUI's Hardcoded White Default

OpenTUI's `TextBufferRenderable` class defines:
```js
_defaultOptions = {
  fg: RGBA.fromValues(1, 1, 1, 1),  // hardcoded WHITE
  ...
}
```

When a `<text>` element has no explicit `fg` prop, OpenTUI falls back to this white default. On light terminals, white text on white background = invisible.

The markdown component (`<markdown>`) has an additional layer: when tree-sitter returns no syntax highlights (plain text, code blocks without language, or any unstyled segment), the text buffer uses `_defaultFg` — also white.

Our syntax theme's `"default"` scope was correctly defined, but OpenTUI's `treeSitterToTextChunks` only applies syntax styles to highlighted segments. Unstyled segments fall back to `_defaultFg`.

## What Was Fixed

### 1. Explicit `fg={colors.text}` on all `<text>` elements
Added explicit foreground color to every `<text>` that was missing one:
- `tool-card.tsx` — tool name
- `user-message.tsx` — user message text
- `thinking.tsx` — "Thinking" label
- `sub-agent-view.tsx` — child tool name
- `permission-prompt.tsx` — "Allow X?" prompt
- `footer-bar.tsx` — streaming/steering labels
- `question-prompt.tsx` — option labels, review header, answer values
- `diff-view.tsx`, `write-stream-view.tsx` — file paths and change counts

### 2. Syntax theme "default" scope
Added `{ scope: ["default", "text"], style: { foreground: "#e4e4e4" } }` to dark theme and `{ foreground: "#1c1c1c" }` to light theme. Also added TreeSitter-style fallback scopes (`text.literal`, `text.strong`, `text.emphasis`, etc.) to both themes.

### 3. Replaced remaining hardcoded colors
- `#365A61` (dark teal) → `colors.toolPath` in `tool-card.tsx` and `sub-agent-view.tsx`
- `#98C379` (light green) → `colors.success` in `tool-card.tsx` and `sub-agent-view.tsx`

### 4. Theme detection restructure
Moved theme detection from module-load time to **after renderer creation** so we can use `renderer.getPalette()` (OpenTUI's native OSC-based terminal palette query). Added fallback chain:
```
Tier 1: --theme light|dark CLI flag
Tier 2: QUARK_THEME=light|dark env var
Tier 3: renderer.getPalette() (OSC queries — real TTY only)
Tier 4: Terminal config file parsing (Ghostty, KiTTY, iTerm2)
Tier 5: macOS system dark-mode preference
Tier 6: Hard-coded dark fallback
```

### 5. OpenTUI patch: intercept RGBA.fromValues(1,1,1,1)
The critical fix. Since OpenTUI's `TextBufferRenderable._defaultOptions.fg` is evaluated at **instance creation time** via `RGBA.fromValues(1,1,1,1)`, we monkey-patch that function to return the active theme's `colors.text` instead of white:

```ts
const originalFromValues = RGBA.fromValues.bind({} as any)
let currentDefaultText = colors.text

;(RGBA as any).fromValues = function (r, g, b, a) {
  if (r === 1 && g === 1 && b === 1 && a === 1) {
    return currentDefaultText  // theme color, not white
  }
  return originalFromValues(r, g, b, a)
}
```

This patch is applied once at module load and stays in sync via `syncDefaultTextColor()` called inside `applyTheme()`.

## Files Changed
- `src/tui/components/assistant-message.tsx` — added `colors` import
- `src/tui/components/diff-view.tsx` — `fg={colors.text}` on labels
- `src/tui/components/footer-bar.tsx` — `fg={colors.text}` on labels
- `src/tui/components/permission-prompt.tsx` — `fg={colors.text}` on prompt
- `src/tui/components/question-prompt.tsx` — `fg={colors.text}` on options/answers
- `src/tui/components/sub-agent-view.tsx` — `fg={colors.text}` on tool name, replaced hardcoded colors
- `src/tui/components/thinking.tsx` — `fg={colors.text}` on label
- `src/tui/components/tool-card.tsx` — `fg={colors.text}` on tool name, replaced hardcoded colors
- `src/tui/components/user-message.tsx` — `fg={colors.text}` on message text
- `src/tui/components/write-stream-view.tsx` — `fg={colors.text}` on labels
- `src/tui/index.tsx` — deferred theme detection, added `--theme` and `QUARK_THEME` support
- `src/tui/terminal-bg.ts` — complete rewrite with 4-tier fallback detection
- `src/tui/theme.ts` — added `darkTheme`/`lightTheme` exports, RGBA patch
- `src/tui/themes/dark.ts` — added `"default"` syntax scope, removed duplicates
- `src/tui/themes/light.ts` — added `"default"` syntax scope, removed duplicates

## Verification
- `bun test-syntax-style.ts` confirmed `getStyle("default")` returns correct color
- `bun test-rgba-patch.ts` confirmed `RGBA.fromValues(1,1,1,1)` returns theme color after patch
- Type-check passes (no new errors introduced)
