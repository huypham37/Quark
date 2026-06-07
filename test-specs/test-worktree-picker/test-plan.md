---
title: "Worktree Picker & Switching — Test Plan"
date_created: 2026-06-07
date_modified: 2026-06-07
revision: 1
history:
  - 2026-06-07: Initial draft
status: draft
---

## Objective

Verify that the `/worktree` TUI command correctly:
1. Parses `git worktree list --porcelain` output into structured data
2. Filters worktrees to project scope (root + `.quark/worktrees/` children)
3. Sanitizes branch names for filesystem-safe directory names
4. Resolves worktree by id or path for navigation
5. Constructs correct `git worktree add` arguments for new/existing branches
6. Builds picker rows with correct ordering, marking, and session counts
7. Navigates picker rows skipping disabled entries
8. Resets session state on worktree switch (messages, tokens, cost, permission, question)
9. Updates cwd, activeWorktree, activeBranch, modelSpec, skillCount on switch
10. Manages worktreeSwitching flag during switch lifecycle

## Test Strategy

- **Unit tests** for pure functions: parsing, filtering, sanitizing, resolving, building args, building rows, navigation
- **State reducer tests** for the SolidJS dispatch layer: worktree-switched, worktree-switch-start, worktree-switch-failed
- **Mock filesystem and git** — no actual git worktrees or filesystem access needed; all inputs are pre-built strings/objects
- **TDD red phase** — all tests written to fail before implementation exists

### Approach

Tests are written BEFORE implementation. They target functions and interfaces defined in:
- `src/worktree/worktree.ts` — data layer (does not exist yet)
- `src/tui/worktree-picker.ts` — picker UI logic (does not exist yet)
- `src/tui/state.ts` — reducer additions

## Environment

- Bun test runtime (`bun:test`)
- No filesystem or git dependencies — pure unit tests with mocked inputs
- SolidJS `createRoot` wrapper for state tests (existing pattern)

## Entry/Exit Criteria

**Entry**: Spec exists (`specs/tui/worktree-picker.md`). Test framework configured.
**Exit**: All test cases pass after implementation is complete.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Interface signatures may change during implementation | Tests define the contract; implementation conforms |
| `AppStore` additions require `createAppState` signature changes | Tests specify expected new fields with sensible defaults |
| Porcelain output format may have edge cases not covered | Tests include detached HEAD, prunable, empty, and boundary cases |

## Schedule

- Test writing: 1 session (this task)
- Implementation: subsequent task
- Manual E2E verification: after implementation

## Test Structure

### test/worktree/worktree.test.ts (NEW)
- `parseWorktreeList()` — 8 test cases
- `filterToProjectWorktrees()` — 5 test cases
- `sanitizeBranchForPath()` — 4 test cases
- `getWorktreeBranch()` — 3 test cases
- `resolveWorktree()` — 5 test cases
- `buildCreateArgs()` — 4 test cases

### test/tui/worktree-picker.test.ts (NEW)
- `buildWorktreeRows()` — 6 test cases
- `firstSelectableWorktreeRow()` — 3 test cases
- `moveWorktreeRowSelection()` — 4 test cases

### test/tui/state.test.ts (MODIFY)
- `worktree-switch-start` — 1 test case
- `worktree-switched` — 4 test cases
- `worktree-switch-failed` — 2 test cases
