---
title: Steer goal divider
date_created: 2026-06-07
date_modified: 2026-06-07
revision: 4
history:
  - 2026-06-07: Initial implementation plan
  - 2026-06-07: Implemented and verified persistence, projections, and TUI rendering
  - 2026-06-07: Replaced hyphens with heavy box-drawing divider lines
  - 2026-06-07: Removed the footer steering label ellipsis
status: done
---

# Steer Goal Divider

## Problem

The goal appended by `/steer` looks like a normal user message, so the branch
boundary is not visually distinct.

## Architecture

Persist a display variant on the steer goal's text part. Conversation
projections preserve that variant, and the TUI renders it as an italic divider.
The model-facing text remains unchanged.

## Decisions

- Store structured metadata instead of inferring steer messages from text.
- Keep the message role as `user` so model context semantics do not change.
- Render `━━━━━━━━━━━━━━━━━━━━━ Steered · <goal> ━━━━━━━━━━━━━━━━━━━━━`
  in italics only for tagged messages.

## Acceptance Criteria

- `/steer Improving the TUI` renders as an italic steer divider.
- Normal user messages retain their existing rendering.
- The divider survives session persistence and reload.
- Branch and TUI tests pass.
