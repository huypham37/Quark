---
title: Async Message Panel (/async-msg)
date_created: 2026-06-04
date_modified: 2026-06-04
revision: 3
history:
  - 2026-06-04: Initial draft
  - 2026-06-04: Implementation complete — state, events, command, component, backend handler
  - 2026-06-04: Redesigned to interactive panel — lazy session creation, mini textarea input, no title/prompt args needed
status: done
---

## Design Evolution

### Phase 1 (implemented): Interactive panel with lazy session creation

`/async-msg` + Enter opens an empty panel with a mini input. The ephemeral session is
created **lazily** on the first message sent from the panel. No title or prompt
arguments required — the user types interactively into the panel itself.

**Flow:**
```
/async-msg + Enter
        │
        ▼
┌─ msg ────────────────┐
│                      │
│                      │
│──────────────────────│
│  > type here _       │
└──────────────────────┘
        │
        ▼
User types "fix auth" + Enter
        │
        ▼
Session created lazily
        │
        ▼
┌─ msg ────────────────┐
│                      │
│  You: fix auth       │
│  ● Working…          │
│                      │
│──────────────────────│
│  > type here _       │
└──────────────────────┘
```

### Why no title argument

The user does not refer back to async sessions (they are ephemeral by design), so
a title is unnecessary. A static short title ("msg") is sufficient for the overlay.
---

# Async Message Panel (`/async-msg`)

## Problem

Users want a quick side-conversation without polluting the main session — e.g.
report a bug, jot an idea, or ask a quick question while the main agent loop
runs. Switching sessions (`/new`, `/sessions`) is too heavy for this use case.

## Solution

`/async-msg <title> <prompt>` opens a small overlay panel on the right side of
the TUI. The panel hosts a **parallel ephemeral session** that runs in the
background. The main session is unaffected. When the side agent finishes, the
result is shown in the panel.

### Phase 1: One-shot (MVP)

`/async-msg <title> <prompt>` spawns a side ephemeral session, runs one prompt,
and shows the final answer in the panel. The panel is read-only (no follow-up
input).

### Phase 2: Follow-up (future)

Mini input inside the panel for back-and-forth. Out of scope for this spec.

---

## Architecture

### Backend

```diagram
╭────────────╮     ╭────────────────╮     ╭──────────────╮
│ /async-msg │────▶│ createSession  │────▶│ ephemeral   │
│ command    │     │ { ephemeral }  │     │ session     │
╰────────────╯     ╰────────────────╯     ╰──────┬───────╯
                                                  │
                                         prompt({ sessionId, ephemeral })
                                                  │
                                                  ▼
                                           agent loop runs
                                           events → bus
```

All primitives exist:
- `createSession({ ephemeral: true })` — in-memory, no disk
- `prompt({ sessionId, ephemeral: true })` — full agent loop on side session
- `bus` — typed EventEmitter, can carry events from any session

### TUI

```diagram
╭──────────────────────────────────────╮  ╭──────────────────╮
│  Main chat scrollbox                 │  │  Async Panel     │
│                                      │  │  (absolute right) │
│  User: refactor auth.ts             │  │  ┌─ bug-report ──┐│
│  Assistant: ✓ Done                   │  │  │ You: crash... ││
│                                      │  │  │ ● Working...  ││
│                                      │  │  └───────────────┘│
╰──────────────────────────────────────╯  ╰──────────────────╯
╭──────────────────────────────────────────────────────────╮
│  Prompt input area                                       │
╰──────────────────────────────────────────────────────────╯
```

Panel is `position="absolute"`, `right: 0`, `top: 0`, `width: 40`, `zIndex: 500`.
Same pattern as `StatisticsPanel`.

---

## Data Model

### New fields in `AppStore` (`src/tui/state.ts`)

```ts
interface AsyncPanel {
  sessionId: string | null
  title: string
  collapsed: boolean
  messages: TuiMessage[]
  running: boolean
  done: boolean
  toolsUsed: number
  unread: number
}
```

### New actions

- `open-async-panel` — `{ sessionId, title }`
- `close-async-panel` — clears the panel
- `async-text-start` — `{ messageId }`
- `async-text-delta` — `{ messageId, delta, text }`
- `async-text-end` — `{ messageId, text }`
- `async-assistant-done` — `{ messageId }`
- `async-tool-start` / `async-tool-end` — increments `toolsUsed`, swallows render
- `async-set-running` — `{ running }`
- `toggle-async-collapse` — flips `collapsed`

---

## Display Rules

| What | Main session | Async panel |
|------|------------|-------------|
| Thinking blocks | Rendered normally | **Swallowed** (not shown) |
| Tool cards | Rendered normally | **Swallowed** — show `● Working…` aggregate |
| Streaming text | Rendered normally | **Swallowed** — only final text shown |
| User messages | Rendered normally | **Shown** (the initial prompt) |
| Assistant text | Rendered normally | **Shown** (only after text-end) |

### Collapsed state

```
┌─ bug-report ● ─────────────┐
│  ⠋ thinking…               │
└────────────────────────────┘
```

- Title bar only
- `●` badge if unread messages
- Spinner or checkmark based on `running` / `done`
- Click / Enter expands

### Expanded state

```
┌─ bug-report ───────────────┐
│                            │
│  You: crash on save...     │
│                            │
│  ● Working…                │
│     (tools hidden)         │
│                            │
│  Final answer text here.   │
└────────────────────────────┘
```

---

## Keybindings (while panel is open)

| Key | Action |
|-----|--------|
| `Ctrl+Shift+A` | Toggle collapse/expand |
| `Escape` | Close panel (cancel side session if running) |

---

## Event Bus Multiplexing

`wireEvents` currently subscribes to ONE session inside `createComputed`.
For async-msg we need a **persistent** second subscription for the side
session, registered outside `createComputed`.

```ts
// In wireEvents (src/tui/events.ts)
// Existing: createComputed(() => { const sid = state.store.sessionId; ... })
// New: persistent listener for asyncPanel.sessionId

bus.on("text-delta", (data) => {
  if (data.sessionId === state.store.asyncPanel?.sessionId) {
    dispatch(state, { type: "async-text-delta", ... })
  }
})
```

All events matching the async panel's sessionId are routed to `async-*`
actions instead of the default actions. This keeps the main chat untouched.

---

## Files to Change

| File | Change |
|------|--------|
| `specs/tui/async-msg-panel.md` | **New** — this spec |
| `src/tui/commands.ts` | Add `async-msg` to slash registry |
| `src/tui/state.ts` | Add `AsyncPanel` type + new actions |
| `src/tui/events.ts` | Persistent side-session event wiring |
| `src/tui/components/App.tsx` | Mount `<AsyncPanel />`; handle `/async-msg` command; keybinds |
| `src/tui/components/async-panel.tsx` | **New** — condensed panel overlay |
| `src/tui/index.tsx` | Backend command handler for `/async-msg` |

---

## Acceptance Criteria

- [ ] `/async-msg <title> <prompt>` opens a side panel and starts an ephemeral session
- [ ] Main session chat is unaffected while side session runs
- [ ] Panel shows `● Working…` while side agent runs
- [ ] Panel shows final assistant text when done (no thinking, no tool cards)
- [ ] Panel has collapse/expand toggle
- [ ] Collapsed state shows title + spinner/checkmark + unread badge
- [ ] `Escape` closes the panel and cancels the side session if running
- [ ] Side session is ephemeral (never written to disk)
- [ ] Manual end-to-end test via termctrl passes
- [ ] No regression in main session event handling or keyboard shortcuts

---

## Out of Scope

- Follow-up messages inside the panel (Phase 2)
- Multiple simultaneous async panels
- Persisting panel content across TUI restarts
- Drag-to-resize panel width
