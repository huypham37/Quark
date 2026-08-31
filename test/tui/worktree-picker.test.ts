// Tests for worktree picker UI logic — buildWorktreeRows, firstSelectableWorktreeRow, moveWorktreeRowSelection
//
// These tests define the contract for src/tui/worktree-picker.ts.
// The module does NOT exist yet — these tests are written TDD-style to fail first.
//
// Follows the same pattern as session-tree-picker.test.ts.

import { describe, test, expect } from "bun:test"

// ---------------------------------------------------------------------------
// Interfaces — define the contract that src/tui/worktree-picker.ts must export
// ---------------------------------------------------------------------------

import type { WorktreeInfo } from "../../src/worktree/worktree"

/** A single row in the worktree picker */
export type WorktreePickerRow =
  | { type: "worktree"; id: string; label: string; branch: string | null; sessionCount: number; current: boolean; root: boolean }
  | { type: "disabled"; id: string; label: string; branch: string | null; reason: string }
  | { type: "header"; label: string }

// ---------------------------------------------------------------------------
// Import functions under test — will fail since module doesn't exist yet
// ---------------------------------------------------------------------------

// Import functions under test
import {
  buildWorktreeRows,
  firstSelectableWorktreeRow,
  moveWorktreeRowSelection,
} from "../../src/tui/worktree-picker"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeWorktree(opts: {
  id: string
  path: string
  branch?: string | null
  shortHash?: string
  isRoot?: boolean
  isCurrent?: boolean
  prunable?: boolean
  missing?: boolean
}): WorktreeInfo {
  return {
    id: opts.id,
    path: opts.path,
    branch: opts.branch ?? null,
    shortHash: opts.shortHash ?? "abcdef1",
    isRoot: opts.isRoot ?? false,
    isCurrent: opts.isCurrent ?? false,
    prunable: opts.prunable ?? false,
    missing: opts.missing ?? false,
  }
}

const projectBase = "/Users/mac/projects/Quark"
const worktreeBase = `${projectBase}/.quark/worktrees`

// ---------------------------------------------------------------------------
// buildWorktreeRows
// ---------------------------------------------------------------------------

describe("buildWorktreeRows", () => {
  test("puts root first", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth" }),
      makeWorktree({ id: "refactor-db", path: `${worktreeBase}/refactor-db`, branch: "refactor/db" }),
    ]

    const rows = buildWorktreeRows(worktrees, null, {})

    expect(rows.length).toBeGreaterThanOrEqual(1)
    const firstRow = rows[0]!
    expect(firstRow.type).toBe("worktree")
    if (firstRow.type === "worktree") {
      expect(firstRow.root).toBe(true)
      expect(firstRow.id).toBe("root")
    }
  })

  test("marks current worktree", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: false }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth", isCurrent: true }),
      makeWorktree({ id: "refactor-db", path: `${worktreeBase}/refactor-db`, branch: "refactor/db" }),
    ]

    const rows = buildWorktreeRows(worktrees, "feature-login-auth", {})

    const currentRow = rows.find((r) => r.type === "worktree" && r.id === "feature-login-auth")
    expect(currentRow).toBeDefined()
    if (currentRow && currentRow.type === "worktree") {
      expect(currentRow.current).toBe(true)
    }

    const rootRow = rows.find((r) => r.type === "worktree" && r.id === "root")
    if (rootRow && rootRow.type === "worktree") {
      expect(rootRow.current).toBe(false)
    }
  })

  test("hides prunable worktrees", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "stale", path: `${worktreeBase}/stale`, branch: "stale", prunable: true }),
      makeWorktree({ id: "active", path: `${worktreeBase}/active`, branch: "active" }),
    ]

    const rows = buildWorktreeRows(worktrees, "root", {})

    // Prunable worktrees should not appear in the picker at all
    const staleRow = rows.find((r: any) => (r as any).id === "stale")
    expect(staleRow).toBeUndefined()

    const activeRow = rows.find((r: any) => (r as any).id === "active")
    expect(activeRow).toBeDefined()
    expect(activeRow!.type).toBe("worktree")
  })

  test("disables worktrees with missing directories", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "deleted", path: `${worktreeBase}/deleted`, branch: "deleted", missing: true }),
    ]

    const rows = buildWorktreeRows(worktrees, "root", {})

    const deletedRow = rows.find((r: any) => (r as any).id === "deleted")
    expect(deletedRow).toBeDefined()
    expect(deletedRow!.type).toBe("disabled")
  })

  test("includes session count in label", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth" }),
    ]

    const sessionCounts: Record<string, number> = {
      root: 5,
      "feature-login-auth": 3,
    }

    const rows = buildWorktreeRows(worktrees, "root", sessionCounts)

    const rootRow = rows.find((r) => r.type === "worktree" && r.id === "root")
    expect(rootRow).toBeDefined()
    if (rootRow && rootRow.type === "worktree") {
      expect(rootRow.sessionCount).toBe(5)
      expect(rootRow.label).toContain("5")
    }

    const featRow = rows.find((r) => r.type === "worktree" && r.id === "feature-login-auth")
    expect(featRow).toBeDefined()
    if (featRow && featRow.type === "worktree") {
      expect(featRow.sessionCount).toBe(3)
      expect(featRow.label).toContain("3")
    }
  })

  test("handles only root (no project worktrees)", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
    ]

    const rows = buildWorktreeRows(worktrees, "root", {})

    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe("worktree")
    if (rows[0]!.type === "worktree") {
      expect(rows[0]!.root).toBe(true)
      expect(rows[0]!.current).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// firstSelectableWorktreeRow
// ---------------------------------------------------------------------------

describe("firstSelectableWorktreeRow", () => {
  test("returns the create action when it is first", () => {
    const rows = [
      { type: "create" as const, label: "+ Create worktree" },
      ...buildWorktreeRows([
        makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      ], "root", {}),
    ]

    expect(firstSelectableWorktreeRow(rows)).toBe(0)
  })

  test("returns root index when root is selectable", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth" }),
    ]

    const rows = buildWorktreeRows(worktrees, "root", {})

    const idx = firstSelectableWorktreeRow(rows)
    expect(idx).toBe(0)
    const row = rows[idx]!
    expect(row.type).toBe("worktree")
    if (row.type === "worktree") {
      expect(row.id).toBe("root")
    }
  })

  test("skips disabled rows at start", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true, missing: true }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth" }),
      makeWorktree({ id: "refactor-db", path: `${worktreeBase}/refactor-db`, branch: "refactor/db" }),
    ]

    // Root is missing → disabled, so first selectable should be feature-login-auth
    const rows = buildWorktreeRows(worktrees, "feature-login-auth", {})

    const idx = firstSelectableWorktreeRow(rows)
    expect(idx).toBeGreaterThanOrEqual(0)

    const row = rows[idx]!
    expect(row.type).toBe("worktree")
    if (row.type === "worktree") {
      expect(row.id).toBe("feature-login-auth")
    }
  })

  test("returns -1 when all rows are disabled", () => {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true, missing: true }),
    ]

    const rows = buildWorktreeRows(worktrees, "root", {})
    // Root is missing → it becomes disabled, leaving no selectable rows

    const idx = firstSelectableWorktreeRow(rows)
    expect(idx).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// moveWorktreeRowSelection
// ---------------------------------------------------------------------------

describe("moveWorktreeRowSelection", () => {
  function makeRows(): { rows: ReturnType<typeof buildWorktreeRows> } {
    const worktrees: WorktreeInfo[] = [
      makeWorktree({ id: "root", path: projectBase, branch: "main", isRoot: true, isCurrent: true }),
      makeWorktree({ id: "disabled-one", path: `${worktreeBase}/disabled-one`, branch: "stale", missing: true }),
      makeWorktree({ id: "feature-login-auth", path: `${worktreeBase}/feature-login-auth`, branch: "feature/login-auth" }),
      makeWorktree({ id: "refactor-db", path: `${worktreeBase}/refactor-db`, branch: "refactor/db" }),
      makeWorktree({ id: "disabled-two", path: `${worktreeBase}/disabled-two`, branch: "deleted", missing: true }),
    ]
    return { rows: buildWorktreeRows(worktrees, "root", {}) }
  }

  test("moves down to next selectable, skipping disabled", () => {
    const { rows } = makeRows()

    // Find root index
    const rootIdx = rows.findIndex((r) => r.type === "worktree" && r.id === "root")
    expect(rootIdx).toBeGreaterThanOrEqual(0)

    // Move down once — should skip disabled-one and land on feature-login-auth
    const nextIdx = moveWorktreeRowSelection(rows, rootIdx, 1)
    const nextRow = rows[nextIdx]!
    expect(nextRow.type).toBe("worktree")
    if (nextRow.type === "worktree") {
      expect(nextRow.id).toBe("feature-login-auth")
    }

    // Move down again — should land on refactor-db
    const thirdIdx = moveWorktreeRowSelection(rows, nextIdx, 1)
    const thirdRow = rows[thirdIdx]!
    expect(thirdRow.type).toBe("worktree")
    if (thirdRow.type === "worktree") {
      expect(thirdRow.id).toBe("refactor-db")
    }
  })

  test("moves up to previous selectable, skipping disabled", () => {
    const { rows } = makeRows()

    // Find refactor-db index
    const refactorIdx = rows.findIndex((r) => r.type === "worktree" && r.id === "refactor-db")
    expect(refactorIdx).toBeGreaterThanOrEqual(0)

    // Move up once — should skip disabled-two and land on feature-login-auth
    const prevIdx = moveWorktreeRowSelection(rows, refactorIdx, -1)
    const prevRow = rows[prevIdx]!
    expect(prevRow.type).toBe("worktree")
    if (prevRow.type === "worktree") {
      expect(prevRow.id).toBe("feature-login-auth")
    }

    // Move up again — should skip disabled-one and land on root
    const rootIdx = moveWorktreeRowSelection(rows, prevIdx, -1)
    const rootRow = rows[rootIdx]!
    expect(rootRow.type).toBe("worktree")
    if (rootRow.type === "worktree") {
      expect(rootRow.id).toBe("root")
    }
  })

  test("clamps at top (moving up from first selectable returns same index)", () => {
    const { rows } = makeRows()

    const firstIdx = firstSelectableWorktreeRow(rows)
    const result = moveWorktreeRowSelection(rows, firstIdx, -1)
    expect(result).toBe(firstIdx)
  })

  test("clamps at bottom (moving down from last selectable returns same index)", () => {
    const { rows } = makeRows()

    // Find last selectable
    let lastIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.type === "worktree") {
        lastIdx = i
        break
      }
    }
    expect(lastIdx).toBeGreaterThanOrEqual(0)

    const result = moveWorktreeRowSelection(rows, lastIdx, 1)
    expect(result).toBe(lastIdx)
  })
})
