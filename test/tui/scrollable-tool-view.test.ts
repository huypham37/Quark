// Tests for pure helper functions that will back the scrollable tool views.
//
// Two functions under test:
//
//   computeScrollHeight(totalLines, maxHeight) → number
//     Returns the height the scrollbox should occupy: the lesser of the
//     actual line count and the configured maximum.  Short outputs render
//     at natural height; long outputs are capped so the area stays bounded.
//
//   countTotalDiffLines(hunks) → number
//     Sums the number of DiffLine entries across every hunk.  The result
//     feeds directly into computeScrollHeight for DiffView.

import { describe, test, expect } from "bun:test"
import type { DiffHunk } from "../../src/tui/diff-utils"

// ---------------------------------------------------------------------------
// Pure functions under test
// ---------------------------------------------------------------------------
//
// These will live alongside their respective components once the scrollable
// view work is done.  For now we define them inline here so the tests can
// be written before the production code exists (red phase).

/**
 * Returns the height (in lines) that the scrollbox viewport should occupy.
 * Short content renders at its natural height; content taller than maxHeight
 * is capped so the area never exceeds the configured limit.
 */
function computeScrollHeight(totalLines: number, maxHeight: number): number {
  return Math.min(totalLines, maxHeight)
}

/**
 * Counts the total number of DiffLine entries across all hunks.
 * Used to derive the totalLines argument for computeScrollHeight in DiffView.
 */
function countTotalDiffLines(hunks: DiffHunk[]): number {
  return hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
}

// ---------------------------------------------------------------------------
// computeScrollHeight
// ---------------------------------------------------------------------------

describe("computeScrollHeight", () => {
  const MAX = 40 // representative MAX_SCROLL_HEIGHT constant

  // --- below the cap ---

  test("returns totalLines when content is shorter than maxHeight", () => {
    expect(computeScrollHeight(10, MAX)).toBe(10)
  })

  test("returns totalLines when content is exactly one line", () => {
    expect(computeScrollHeight(1, MAX)).toBe(1)
  })

  test("returns totalLines when content is one line below the cap", () => {
    expect(computeScrollHeight(MAX - 1, MAX)).toBe(MAX - 1)
  })

  // --- at the cap ---

  test("returns maxHeight when totalLines equals maxHeight (no scroll needed)", () => {
    expect(computeScrollHeight(MAX, MAX)).toBe(MAX)
  })

  // --- above the cap ---

  test("returns maxHeight when content is one line over the cap", () => {
    expect(computeScrollHeight(MAX + 1, MAX)).toBe(MAX)
  })

  test("returns maxHeight when content is significantly taller than the cap", () => {
    expect(computeScrollHeight(200, MAX)).toBe(MAX)
  })

  test("returns maxHeight regardless of how large totalLines is", () => {
    expect(computeScrollHeight(10_000, MAX)).toBe(MAX)
  })

  // --- edge / boundary values ---

  test("returns 0 when totalLines is 0 (empty content)", () => {
    expect(computeScrollHeight(0, MAX)).toBe(0)
  })

  test("returns 0 when both totalLines and maxHeight are 0", () => {
    expect(computeScrollHeight(0, 0)).toBe(0)
  })

  test("works correctly with maxHeight of 1", () => {
    expect(computeScrollHeight(5, 1)).toBe(1)
    expect(computeScrollHeight(1, 1)).toBe(1)
    expect(computeScrollHeight(0, 1)).toBe(0)
  })

  test("works correctly with the DiffView legacy cap (30 lines)", () => {
    expect(computeScrollHeight(29, 30)).toBe(29)
    expect(computeScrollHeight(30, 30)).toBe(30)
    expect(computeScrollHeight(31, 30)).toBe(30)
  })

  test("works correctly with the WriteStreamView legacy cap (30 lines)", () => {
    expect(computeScrollHeight(30, 30)).toBe(30)
    expect(computeScrollHeight(150, 30)).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// countTotalDiffLines
// ---------------------------------------------------------------------------

describe("countTotalDiffLines", () => {
  // Helper: build a minimal DiffHunk with n lines (type doesn't matter here)
  function makeHunk(lineCount: number): DiffHunk {
    return {
      oldStart: 1,
      oldLines: lineCount,
      newStart: 1,
      newLines: lineCount,
      lines: Array.from({ length: lineCount }, (_, i) => ({
        type: "context" as const,
        content: `line ${i + 1}`,
        oldLineNo: i + 1,
        newLineNo: i + 1,
      })),
    }
  }

  // --- empty input ---

  test("returns 0 for an empty hunk array", () => {
    expect(countTotalDiffLines([])).toBe(0)
  })

  // --- single hunk ---

  test("returns the line count for a single hunk", () => {
    expect(countTotalDiffLines([makeHunk(5)])).toBe(5)
  })

  test("returns 0 for a single hunk with no lines", () => {
    expect(countTotalDiffLines([makeHunk(0)])).toBe(0)
  })

  test("returns 1 for a single hunk with exactly one line", () => {
    expect(countTotalDiffLines([makeHunk(1)])).toBe(1)
  })

  // --- multiple hunks ---

  test("sums lines across two hunks", () => {
    expect(countTotalDiffLines([makeHunk(10), makeHunk(5)])).toBe(15)
  })

  test("sums lines across three hunks", () => {
    expect(countTotalDiffLines([makeHunk(8), makeHunk(12), makeHunk(4)])).toBe(24)
  })

  test("handles hunks where one hunk has zero lines", () => {
    expect(countTotalDiffLines([makeHunk(0), makeHunk(7)])).toBe(7)
  })

  test("handles all hunks having zero lines", () => {
    expect(countTotalDiffLines([makeHunk(0), makeHunk(0)])).toBe(0)
  })

  // --- realistic counts reflecting the old truncation limits ---

  test("returns correct total for five hunks of 30 lines each (old MAX_LINES_PER_HUNK × MAX_HUNKS)", () => {
    const hunks = Array.from({ length: 5 }, () => makeHunk(30))
    expect(countTotalDiffLines(hunks)).toBe(150)
  })

  test("correctly counts mixed added/removed/context line types", () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { type: "context", content: "ctx",     oldLineNo: 1, newLineNo: 1 },
        { type: "removed", content: "old line", oldLineNo: 2 },
        { type: "added",   content: "new line",              newLineNo: 2 },
        { type: "context", content: "ctx",     oldLineNo: 3, newLineNo: 3 },
      ],
    }
    // 4 lines regardless of their type
    expect(countTotalDiffLines([hunk])).toBe(4)
  })

  // --- composition with computeScrollHeight ---

  test("composed: total lines below cap yields natural height", () => {
    const hunks = [makeHunk(5), makeHunk(8)]          // 13 lines total
    const height = computeScrollHeight(countTotalDiffLines(hunks), 40)
    expect(height).toBe(13)
  })

  test("composed: total lines above cap yields capped height", () => {
    const hunks = [makeHunk(30), makeHunk(30), makeHunk(30)] // 90 lines
    const height = computeScrollHeight(countTotalDiffLines(hunks), 40)
    expect(height).toBe(40)
  })

  test("composed: exactly at cap yields maxHeight", () => {
    const hunks = [makeHunk(20), makeHunk(20)]         // 40 lines
    const height = computeScrollHeight(countTotalDiffLines(hunks), 40)
    expect(height).toBe(40)
  })
})
