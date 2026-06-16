---
title: Noisy Footer and BFS Grid
date_created: 2026-06-05
date_modified: 2026-06-05
revision: 1
history:
  - 2026-06-05: Initial draft detailing the problem
status: draft
---

# Noisy Footer (BFS 4x4 Grid + Spinner)

## Problem
When the agent is running, the TUI is visually overwhelming due to multiple simultaneous animations competing for attention.

## Root Cause
The **BFS effect** defined in `src/tui/spinner.ts` (`SPINNER_FRAMES`) encodes 17 braille frames simulating a breadth-first search filling a 4x4 grid. It cycles every 1.36s (80ms/frame) and runs simultaneously in:
- The footer bar (`footer-bar.tsx`)
- Every running tool's inline spinner (`inline-spinner.tsx` via `tool-card.tsx`)
- Sub-agent tree lines (`tree-line.tsx`)

Additionally, there are whimsical labels cycling every 4 seconds in the footer ("Conjuring...", "Brewing...", etc.). The high visual complexity of 16 dots changing in pseudo-random order creates a highly distracting terminal environment.
