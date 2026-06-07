---
title: Truncated Diff View
date_created: 2026-06-05
date_modified: 2026-06-07
revision: 3
history:
  - 2026-06-05: Initial draft detailing the problem
  - 2026-06-07: Removed truncateLine() from diff-view.tsx; replaced with wrap="wrap" on content <Text>
  - 2026-06-07: Added flexShrink={0} to prefix elements and flexShrink={1} to content text so line numbers and │ align correctly on wrapped rows
status: done
---

# Truncated Diff View

## Problem
Edit and write tool diffs are extremely hard to read because they are aggressively truncated at 80 characters. For deeply-indented code, the meaningful change at the end of the line is often completely cut off and replaced with `...`.

## Root Cause
The `DiffView` component (`src/tui/components/diff-view.tsx`) suffers from three layers of hardcoded truncation that are **not terminal-width-aware**:
1. `truncateLine(content, 80)`: Every diff line is cut at 80 chars. 
2. `MAX_LINES_PER_HUNK = 30`: Large hunks are silently truncated.
3. `MAX_HUNKS = 5`: Multi-site edits lose later hunks.

Additionally, layout overhead (margins, line numbers, separator, prefix) eats ~12-14 columns, meaning the actual code gets far fewer than 80 characters. The horizontal rule is also hardcoded to 42 characters, making the diff look artificially narrow. Similar issues exist in `write-stream-view.tsx`.
