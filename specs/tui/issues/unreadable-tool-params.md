---
title: Unreadable Tool Call Parameters
date_created: 2026-06-05
date_modified: 2026-06-05
revision: 1
history:
  - 2026-06-05: Initial draft detailing the problem
status: draft
---

# Unreadable Tool Call Parameters

## Problem
Tool call parameters (file paths, commands, queries) are rendered with a hardcoded dark teal color `#365A61` that has extremely poor contrast on dark terminals. 
- The contrast ratio against typical dark terminal backgrounds (~#1c1c1c to #21252A) is ~2.5:1, well below the WCAG AA minimum of 4.5:1.
- The use of `underline` further reduces readability on some terminals.
- Ironically, the theme palette already defines a readable color (`colors.toolPath`: `#5f87ff`), but it's only being used by the permission prompt.

## Root Cause
There is a hardcoded use of `RGBA.fromHex("#365A61")` instead of theme palette colors in the following files:
- `src/tui/components/tool-card.tsx:145` (Tool args label)
- `src/tui/components/sub-agent-view.tsx:169` (Child tool labels)
- `src/tui/components/sub-agent-view.tsx:274` (Sub-agent prompt text)
