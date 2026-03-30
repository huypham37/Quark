# GitHub Issue Drafts

## 1. Sub-agent runs are rendered as regular Bash tools when `2>&1` is present

**Goal:** Ensure sub-agent launches render as `SubAgentView` instead of falling back to a normal Bash tool when the command includes stderr redirection.

**Plan:**
- [ ] Prevent `2>&1` from breaking sub-agent event forwarding
- [ ] Keep sub-agent events on the parent stderr parsing path
- [ ] Verify the TUI renders `SubAgentView` for `quark --sub-agent ...`

**Affected files/components:**
- `~/.config/quark/tools/bash.ts`
- `src/session/event-writer.ts`
- `src/tui/state.ts`
- `src/tui/components/message-item.tsx`

**Dependencies:**
- None

---

## 2. Aborted Bash tools stay stuck in the running state

**Goal:** When a Bash tool aborts, the TUI should stop showing it as running and switch the status indicator to `x`.

**Plan:**
- [ ] Update Bash tool state handling for abort paths
- [ ] Ensure the rendered indicator reflects aborted/failed status
- [ ] Verify aborted Bash calls no longer remain in the running state

**Affected files/components:**
- Bash tool execution/state handling
- `src/tui/components/message-item.tsx`
- `src/tui/state.ts`

**Dependencies:**
- None

---

## 3. Bash tool label and command are rendered too close together

**Goal:** Add the missing spacing between the `Bash` tool label and its argument so the command is not visually cramped.

**Plan:**
- [ ] Locate the Bash tool header rendering
- [ ] Add the missing separator/spacing between the label and the command
- [ ] Verify the Bash tool line remains readable in the TUI

**Affected files/components:**
- `src/tui/components/message-item.tsx`
- Bash tool rendering component(s)

**Dependencies:**
- None