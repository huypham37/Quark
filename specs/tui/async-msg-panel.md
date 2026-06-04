---
title: Async Message Panel (/async-msg)
date_created: 2026-06-04
date_modified: 2026-06-04
revision: 4
history:
  - 2026-06-04: Initial draft
  - 2026-06-04: Implementation complete — state, events, command, component, backend handler
  - 2026-06-04: Redesigned to interactive panel — lazy session creation, mini textarea input, no title/prompt args needed
  - 2026-06-04: Visual polish — single-line border, title on border line, solid background, footer hint
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

`/async-msg` + Enter opens a small interactive overlay panel on the right side
of the TUI. The panel hosts a **parallel ephemeral session** that runs in the
background. The main session is unaffected. The user types directly into the
panel; the ephemeral session is created **lazily** on the first submit.

### Interactive design

`/async-msg` requires **no arguments**. The panel opens empty with a mini
`>` input. The user types their question and hits Enter. The session is created
on-demand, the agent loop runs, and the condensed result appears in the panel.

```
/async-msg + Enter
        │
        ▼
┌─ msg ────────────────┐
│                      │
│──────────────────────│
│ > _                  │
│   Enter submit · Esc │
└──────────────────────┘
        │
        ▼
User types "fix auth bug" + Enter
        │
        ▼
┌─ msg ● ──────────────┐
│ You:                 │
│ fix auth bug         │
│                      │
│ ● Working… (1 tools) │
│──────────────────────│
│ > _                  │
│   Enter submit · Esc │
└──────────────────────┘
```

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
  sessionId: string | null  // null until first submit creates the session
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

- `open-async-panel` — `{ sessionId: null, title: "msg" }`
- `set-async-session-id` — `{ sessionId }` (patched in after lazy creation)
- `close-async-panel` — clears the panel
- `async-add-user-message` — `{ id, text }`
- `async-add-assistant-message` — `{ id }`
- `async-text-start` / `async-text-delta` / `async-text-end` — condensed text streaming
- `async-tool-start` — increments `toolsUsed` counter
- `async-assistant-done` — `{ messageId }`
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

### Visual style

Single-line rectangular border (`borderStyle="single"`), title rendered **on
the top border line** via OpenTUI's `title` prop (not as a separate header
row). Every text element carries the panel background to prevent see-through
holes.

```
┌─ msg ──────────────────────┐
│ You:                       │
│ fix auth bug               │
│                            │
│ ✓ Done                     │
│                            │
│────────────────────────────│
│ > _                        │
│      Enter submit · Esc can│
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

## Files Changed

| File | Change |
|------|--------|
| `specs/tui/async-msg-panel.md` | This spec |
| `src/tui/commands.ts` | Add `async-msg` to slash registry (no args) |
| `src/tui/state.ts` | Add `AsyncPanel` type + 10 new dispatch actions |
| `src/tui/events.ts` | Persistent dual-session event routing; `async-panel-open` bus event |
| `src/tui/components/App.tsx` | Mount `<AsyncPanel />`; `/async-msg` opens panel; Escape closes; keyboard passthrough |
| `src/tui/components/async-panel.tsx` | **New** — interactive panel with mini textarea, title-on-border, footer hint |
| `src/tui/index.tsx` | `onCreateAsyncSession` callback; removed old `/async-msg` handler |
| `src/session/events.ts` | `async-panel-open` event type |
| `test/tui/state.test.ts` | 9 async-panel dispatch tests |
| `test/tui/commands.test.ts` | 4 `/async-msg` command tests |
| `test/tui/events.test.ts` | 6 dual-session event routing tests |

---

## Acceptance Criteria

- [x] `/async-msg` opens an interactive side panel (no arguments needed)
- [x] Ephemeral session created lazily on first panel submit
- [x] Main session chat is unaffected while side session runs
- [x] Main input stays active while side agent runs in parallel
- [x] Panel shows `● Working…` while side agent runs
- [x] Panel shows final assistant text when done (no thinking, no tool cards)
- [x] Panel has collapse/expand toggle via `[-]`/`[+]`
- [x] `Escape` closes the panel and cancels the side session if running
- [x] Side session is ephemeral (never written to disk)
- [x] Manual end-to-end test via termctrl passes
- [x] No regression in main session event handling or keyboard shortcuts

---

## Out of Scope

- Follow-up messages inside the panel (Phase 2)
- Multiple simultaneous async panels
- Persisting panel content across TUI restarts
- Drag-to-resize panel width
