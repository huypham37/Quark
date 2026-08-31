// Worktree picker UI logic — build picker rows, navigation
//
// Follows the same pattern as session-tree-picker.ts.
// See specs/tui/worktree-picker.md for design.

import type { WorktreeInfo } from "../worktree/worktree"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row in the worktree picker */
export type WorktreePickerRow =
  | { type: "create"; label: string }
  | { type: "worktree"; id: string; label: string; branch: string | null; sessionCount: number; current: boolean; root: boolean }
  | { type: "disabled"; id: string; label: string; branch: string | null; reason: string }
  | { type: "header"; label: string }

// ---------------------------------------------------------------------------
// buildWorktreeRows
// ---------------------------------------------------------------------------

/**
 * Build picker rows from discovered worktrees.
 *
 * Root is always first. Current worktree is highlighted. Prunable and missing
 * worktrees are rendered as disabled rows.
 */
export function buildWorktreeRows(
  worktrees: WorktreeInfo[],
  currentId: string | null,
  sessionCounts: Record<string, number>,
): WorktreePickerRow[] {
  // Filter: hide prunable worktrees entirely
  const visible = worktrees.filter((wt) => !wt.prunable)

  // Sort: root first, then alphabetically
  const sorted = [...visible].sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  return sorted.map((wt) => {
    const count = sessionCounts[wt.id] ?? 0
    const isCurrent = wt.id === currentId

    if (wt.missing) {
      return {
        type: "disabled" as const,
        id: wt.id,
        label: `${wt.id} (directory missing)`,
        branch: wt.branch,
        reason: "directory missing",
      }
    }

    const branchStr = wt.branch ? ` · ${wt.branch}` : ""
    const sessionsStr = count > 0 ? ` · ${count} session${count !== 1 ? "s" : ""}` : ""

    return {
      type: "worktree" as const,
      id: wt.id,
      label: `${wt.id}${branchStr}${sessionsStr}`,
      branch: wt.branch,
      sessionCount: count,
      current: isCurrent,
      root: wt.isRoot,
    }
  })
}

// ---------------------------------------------------------------------------
// firstSelectableWorktreeRow
// ---------------------------------------------------------------------------

/**
 * Find the first selectable row index.
 * Returns -1 if all rows are disabled.
 */
export function firstSelectableWorktreeRow(rows: WorktreePickerRow[]): number {
  const idx = rows.findIndex((r) => r.type === "create" || r.type === "worktree")
  return idx
}

// ---------------------------------------------------------------------------
// moveWorktreeRowSelection
// ---------------------------------------------------------------------------

/**
 * Move selection up (-1) or down (1), skipping disabled rows.
 * Clamps at bounds — moving past the first/last selectable returns the same index.
 */
export function moveWorktreeRowSelection(
  rows: WorktreePickerRow[],
  selectedIndex: number,
  direction: -1 | 1,
): number {
  for (let i = selectedIndex + direction; i >= 0 && i < rows.length; i += direction) {
    if (rows[i]!.type === "create" || rows[i]!.type === "worktree") return i
  }
  return selectedIndex
}
