// settings-rows — the declarative list of settings shown by the `/settings`
// palette mode.
//
// One row = one setting. The palette renders `label` + `value()` and calls
// `cycle(±1)` on ← / → (or Enter). Rows without `cycle` are informational.
//
// Adding a setting means adding one object here plus (if it needs to change
// behaviour) reading its signal from `settings-store.ts`.

import { SUMMARY_DETAIL_LEVELS, type SummaryDetail } from "../config/config"
import { applyHideReadonlyTools, applySummaryDetail, hideReadonlyTools, summaryDetail } from "./settings-store"

export interface SettingRow {
  id: string
  label: string
  /** Rendered on the right side of the row. Reactive. */
  value: () => string
  /** Advance the value. Editable rows only; `undefined` renders as read-only. */
  cycle?: (direction: 1 | -1) => void
  /** Alternate spellings that should still match a search query. */
  keywords?: string[]
}

function shiftSummaryDetail(direction: 1 | -1): void {
  const levels: readonly SummaryDetail[] = SUMMARY_DETAIL_LEVELS
  const current = levels.indexOf(summaryDetail())
  const next = levels[(current + direction + levels.length) % levels.length]!
  applySummaryDetail(next)
}

/** All settings, in display order. */
export function buildSettingRows(): SettingRow[] {
  return [
    {
      id: "summary-detail",
      label: "Summary detail",
      value: () => summaryDetail(),
      cycle: shiftSummaryDetail,
      keywords: ["tool", "activity", "verbose", "quiet", "normal", "loud"],
    },
    {
      id: "hide-readonly-tools",
      label: "Hide read-only tools",
      value: () => hideReadonlyTools() ? "on" : "off",
      cycle: () => applyHideReadonlyTools(!hideReadonlyTools()),
      keywords: ["read", "grep", "glob", "explore"],
    },
  ]
}

/** Case-insensitive substring match over the label, id, and keywords. */
export function filterSettingRows(rows: readonly SettingRow[], query: string): SettingRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) =>
    row.label.toLowerCase().includes(needle)
    || row.id.includes(needle)
    || (row.keywords ?? []).some((keyword) => keyword.includes(needle)),
  )
}
