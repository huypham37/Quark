// settings-store — live, app-wide view of the settings that the TUI can change
// at runtime.
//
// Why module-level signals instead of props: these values are read deep in the
// render tree (ToolActivity / ToolCard / explore grouping) and written from the
// command palette, which are not in a parent/child relationship. This mirrors
// the `theme.ts` precedent — one mutable module singleton that every consumer
// imports directly.
//
// Reads are reactive (Solid signals), writes go to disk through
// `setConfigField`, which also clears the config cache.

import { createSignal } from "solid-js"
import { DEFAULT_SUMMARY_DETAIL, loadConfig, setConfigField, type SummaryDetail } from "../config/config"

const [summaryDetail, setSummaryDetail] = createSignal<SummaryDetail>(DEFAULT_SUMMARY_DETAIL)
const [hideReadonlyTools, setHideReadonlyTools] = createSignal(false)

/** Current summary detail level. Reactive. */
export { summaryDetail }

/** Whether read-only tool rows (read/grep/glob) are hidden inside activities. Reactive. */
export { hideReadonlyTools }

/**
 * Persist a new level and publish it to the UI.
 *
 * Written before the signal so a failed write (read-only config dir) leaves
 * both the file and the screen on the previous value.
 */
export function applySummaryDetail(level: SummaryDetail): void {
  setConfigField("summaryDetail", level)
  setSummaryDetail(level)
}

/** Persist the read-only-tools toggle and publish it to the UI. */
export function applyHideReadonlyTools(hidden: boolean): void {
  setConfigField("hideReadonlyTools", hidden)
  setHideReadonlyTools(hidden)
}

/**
 * Re-read every setting from disk. Called at startup and after `/configs` (or
 * `/reload-config`) edits the file behind the TUI's back.
 */
export function syncSettingsFromConfig(): void {
  const config = loadConfig()
  setSummaryDetail(config.summaryDetail)
  setHideReadonlyTools(config.hideReadonlyTools)
}

/** What the transcript may show for a tool run at a given level. */
export interface TranscriptVisibility {
  /** Tool call rows (the individual cards) are rendered. */
  expanded: boolean
  /** Tool results (diff, stdout, streamed write) are rendered. */
  results: boolean
  /** Read-only exploration rows (read/grep/glob) are dropped from the list. */
  hideReadonly: boolean
}

/**
 * The level owns expansion — there is no manual disclosure to fight with, which
 * is the point: the transcript keeps the same shape until the user changes it.
 */
export function transcriptVisibility(level: SummaryDetail = summaryDetail()): TranscriptVisibility {
  return {
    expanded: level !== "quiet",
    results: level === "loud",
    hideReadonly: hideReadonlyTools(),
  }
}
