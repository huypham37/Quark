**Goal:** Add a scrollable container for long tool messages so oversized tool output doesn't expand the full message area and push other content off-screen.

**Epic:** EPIC-10 — Interactive TUI

**Priority:** Medium

**Plan:**
- [ ] Identify the TUI component(s) that render tool results and long tool output.
- [ ] Wrap long tool message content in a scrollable view with a sensible max height.
- [ ] Keep the existing message layout intact for short outputs.
- [ ] Verify long tool outputs remain readable without consuming the entire viewport.

**Relevant files:**

| File | Line | Why it's relevant |
|---|---:|---|
| `src/tui/components/message-item.tsx` | L41-L165 | Routes tool parts into the TUI and is the main place to constrain tool message rendering. |
| `src/tui/components/tool-result.tsx` | L86-L132 | Renders tool output, including running/completed/error states and long output blocks. |
| `src/tui/components/App.tsx` | L914-L938 | Defines the main scrollable message area and overall viewport behavior. |

**Acceptance Criteria:**
- Long tool outputs render inside a scrollable area instead of expanding indefinitely.
- Short tool outputs still render normally.
- The main chat layout remains usable when a tool produces very large output.
- The change works for both running and completed tool messages if they can exceed the available space.
