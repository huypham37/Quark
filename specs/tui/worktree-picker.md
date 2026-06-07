---
title: Worktree Picker & Switching
date_created: 2026-06-07
date_modified: 2026-06-07
revision: 3
history:
  - 2026-06-07: Initial plan — oracle design review
  - 2026-06-07: Implementation complete — data layer, picker logic, TUI integration, all tests pass
  - 2026-06-07: Fixed picker persistence, sessionless switching, reactive footer updates, and direct create flow after TUI E2E testing
status: done
---

## Problem

Users need to work on multiple branches in parallel without stashing or juggling
workspaces. A `/worktree` command should let users create git worktrees under
`.quark/worktrees/` and switch between them from within the TUI — similar to
`/sessions` but scoped at the directory level.

## Architecture

### Data Model

```
.quark/worktrees/
  ├── fix-login-auth/       → git worktree on branch fix/login-auth
  │   ├── .quark/           → own tasks, skills, config
  │   └── ...               → full working tree
  └── refactor-db-layer/    → git worktree on branch refactor/db-layer
```

Each worktree is a git worktree — a lightweight clone sharing `.git` with the
root project. Discovery is git-authoritative via `git worktree list --porcelain`,
not filesystem scanning. The root project is always included as the first entry
(`id: "root"`), so switching back is always possible.

### Two-Step Picker Flow

```
/worktree              → worktree picker opens
  user picks "fix-login-auth"
                       → switchToWorktree() runs:
                         - process.chdir(worktree path)
                         - reset session state
                         - reload profile, config, skills, tools
                       → session picker opens (reuses /sessions UI)
  user picks session   → loads conversation
```

No `/worktree <name>` fast-path. Always two steps. `/worktree create <branch>`
creates a worktree, switches to it, and opens the session picker.

## Key Decisions

### 1. Git-authoritative discovery

Use `git worktree list --porcelain` to discover worktrees. Filter to only
those under `.quark/worktrees/` (plus root). This handles:
- Prunable worktrees (disabled in picker)
- Detached HEAD (branch = null, show short hash)
- Missing directories (disabled in picker)

### 2. Root project is always a worktree

`id: "root"`, `isRoot: true`, always first in the picker. This ensures the
user can always switch back. `activeWorktree = null` means root is active.

### 3. Session scoping is automatic

No changes to `session.ts` or `task.ts`. `listProjectSessions()` and
`listTasks()` already read from `process.cwd()`. After `process.chdir()` to a
worktree, they automatically return that worktree's data.

### 4. Footer shows cwd + branch

The footer bar currently captures `process.cwd()` at render time, which is
stale after a worktree switch. Change it to accept `cwd` and `branch` as props
from the store. Remove the stale `const cwd = process.cwd()` capture.

### 5. Agent must not be running during switch

`process.chdir()` is process-global and would affect running tool
subprocesses. Reject the switch with an error message if a session is active.

### 6. Worktree creation sanitises branch names

Branches like `feature/login-auth` become directory names like `feature-login-auth`.
Use `branch.replaceAll("/", "-")` for path safety.

### 7. Empty worktrees are valid

If a worktree has no sessions, the session picker shows "No sessions found".
The user can type a message to lazily create the first session.

## TUI State Changes

### AppStore additions

```typescript
interface AppStore {
  // NEW
  rootProjectDir: string           // immutable, captured at startup
  cwd: string                      // tracks current directory
  activeWorktree: TuiWorktree | null  // null = root
  activeBranch: string | null
  worktreeSwitching: boolean       // true during switch
  // existing fields unchanged...
}
```

### New actions

```typescript
type TuiAction =
  | { type: "worktree-switch-start" }
  | { type: "worktree-switched"; cwd: string; activeWorktree: TuiWorktree | null; activeBranch: string | null; modelSpec: string; skillCount: number }
  | { type: "worktree-switch-failed"; message: string }
```

`worktree-switched` resets session state: `sessionId = null`, `messages = []`,
`tokensUsed = 0`, `cost = 0`, clears permission and question queues.

### SlashState additions

```typescript
interface SlashState {
  mode: "commands" | "sessions" | "worktrees" | ChoicePickerMode
  worktreeRows: WorktreePickerRow[]
  // existing fields...
}
```

## New Files

| File | Purpose |
|------|---------|
| `src/worktree/worktree.ts` | Data layer: discovery, creation, path utilities |
| `src/tui/worktree-picker.ts` | Picker UI logic: build rows, navigation |

## Modified Files

| File | Change |
|------|--------|
| `src/tui/commands.ts` | Add `{ id: "worktree", description: "Switch or create git worktrees", usage: "[create <branch>]" }` |
| `src/tui/state.ts` | Add worktree fields to AppStore, new actions, reducer cases |
| `src/tui/events.ts` | Handle `worktree-switched` bus event |
| `src/tui/index.tsx` | Compute `rootProjectDir`, add `switchToWorktree()`, `/worktree` command handler, `handleGetWorktrees`, pass new props to App |
| `src/tui/components/App.tsx` | `worktrees` slash mode, `openWorktreePicker`, after switch open session picker |
| `src/tui/components/footer-bar.tsx` | Accept `cwd` + `branch` props instead of capturing `process.cwd()` |

## No Changes Required

- `src/session/session.ts` — `listProjectSessions()` already scoped to cwd
- `src/task/task.ts` — `listTasks()` already scoped to cwd
- `src/profile/profile.ts` — reads `.quark/config.yaml` from cwd
- `src/skill/skill.ts` — scans `.quark/skills` from cwd
- `src/session/system.ts` — reads `AGENTS.md` from cwd
- `src/bootstrap.ts` — idempotent, re-called after switch
- `src/config/config.ts` — global, unaffected

## Acceptance Criteria

- `/worktree` opens a picker listing root + worktrees under `.quark/worktrees/`
- Current worktree is marked and sorted first
- Selecting a worktree switches `process.cwd()`, resets conversation, and opens the session picker
- Session picker shows sessions scoped to the selected worktree
- `/worktree create <branch>` creates a git worktree and switches to it
- Footer displays current worktree name and branch
- Switching while agent is running shows error, does not switch
- Deleted/missing worktrees show as disabled in picker
- Root is always available as the first picker entry
- Empty worktrees show "No sessions found" in session picker
- Tests cover: worktree discovery/parsing, picker row construction, reducer state reset
