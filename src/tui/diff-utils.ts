// diff-utils.ts — pure utilities for generating and parsing unified diffs
//
// generateUnifiedDiff: produce a unified diff string from old/new content
// parseDiffHunks:      parse a unified diff string into structured DiffHunk[]

export type DiffLineType = "context" | "added" | "removed"

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNo?: number
  newLineNo?: number
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

// ---------------------------------------------------------------------------
// generateUnifiedDiff
// ---------------------------------------------------------------------------

/**
 * Generate a unified diff string comparing oldContent to newContent.
 * Returns "" if the contents are identical.
 * Uses 3 lines of context around each change.
 */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  if (oldContent === newContent) return ""

  const CONTEXT = 3

  // Normalize CRLF → LF for diffing, then re-inject for display
  const oldLines = oldContent === "" ? [] : oldContent.replace(/\r\n/g, "\n").split("\n")
  const newLines = newContent === "" ? [] : newContent.replace(/\r\n/g, "\n").split("\n")

  // Myers diff — compute edit script as array of ops
  const ops = myersDiff(oldLines, newLines)

  // Group ops into hunks (groups of changes with context)
  const hunks = buildHunks(ops, oldLines, newLines, CONTEXT)

  if (hunks.length === 0) return ""

  const oldHeader = oldContent === "" ? "--- /dev/null" : `--- a/${filePath}`
  const newHeader = newContent === "" ? "+++ /dev/null" : `+++ b/${filePath}`

  const lines: string[] = [oldHeader, newHeader]

  for (const hunk of hunks) {
    const oldCount = hunk.oldLines === 1 ? "1" : `${hunk.oldStart === 0 ? 0 : hunk.oldStart},${hunk.oldLines}`
    const newCount = hunk.newLines === 1 ? "1" : `${hunk.newStart === 0 ? 0 : hunk.newStart},${hunk.newLines}`
    lines.push(`@@ -${oldCount} +${newCount} @@`)

    for (const dl of hunk.lines) {
      if (dl.type === "context") {
        lines.push(" " + dl.content)
      } else if (dl.type === "added") {
        lines.push("+" + dl.content)
      } else {
        lines.push("-" + dl.content)
      }
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Myers diff — O(ND) algorithm producing a flat edit script
// ---------------------------------------------------------------------------

type EditOp =
  | { op: "equal"; oldIdx: number; newIdx: number }
  | { op: "insert"; newIdx: number }
  | { op: "delete"; oldIdx: number }

function myersDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const N = oldLines.length
  const M = newLines.length

  if (N === 0) {
    return newLines.map((_, i) => ({ op: "insert" as const, newIdx: i }))
  }
  if (M === 0) {
    return oldLines.map((_, i) => ({ op: "delete" as const, oldIdx: i }))
  }

  const MAX = N + M
  // v[k] = furthest x reached along diagonal k
  const v: number[] = new Array(2 * MAX + 1).fill(0)
  const trace: number[][] = []

  outer: for (let d = 0; d <= MAX; d++) {
    trace.push([...v])
    for (let k = -d; k <= d; k += 2) {
      const ki = k + MAX
      let x: number
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1]
      } else {
        x = v[ki - 1] + 1
      }
      let y = x - k
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++
        y++
      }
      v[ki] = x
      if (x >= N && y >= M) {
        trace.push([...v])
        break outer
      }
    }
  }

  // Backtrack through trace to recover the edit script
  const ops: EditOp[] = []
  let x = N
  let y = M

  for (let d = trace.length - 1; d >= 1; d--) {
    const prev = trace[d - 1]
    const k = x - y
    const ki = k + MAX

    let prevK: number
    if (k === -d + 1 || (k !== d - 1 && prev[ki - 1] < prev[ki + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = prev[prevK + MAX]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      x--
      y--
      ops.unshift({ op: "equal", oldIdx: x, newIdx: y })
    }

    if (x > prevX) {
      x--
      ops.unshift({ op: "delete", oldIdx: x })
    } else if (y > prevY) {
      y--
      ops.unshift({ op: "insert", newIdx: y })
    }
  }

  // Consume remaining equals at the start
  while (x > 0 && y > 0) {
    x--
    y--
    ops.unshift({ op: "equal", oldIdx: x, newIdx: y })
  }

  return ops
}

// ---------------------------------------------------------------------------
// buildHunks — group edit ops into context hunks
// ---------------------------------------------------------------------------

function buildHunks(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[],
  context: number,
): DiffHunk[] {
  if (ops.length === 0) return []

  // Mark change positions
  const changeAt = new Set<number>()
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op !== "equal") changeAt.add(i)
  }

  if (changeAt.size === 0) return []

  // Build context windows: for each change, expand ±context ops
  const include = new Set<number>()
  for (const ci of changeAt) {
    for (let j = Math.max(0, ci - context); j <= Math.min(ops.length - 1, ci + context); j++) {
      include.add(j)
    }
  }

  // Split into contiguous runs (hunks)
  const hunkRanges: Array<[number, number]> = []
  const sorted = [...include].sort((a, b) => a - b)
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== prev + 1) {
      hunkRanges.push([start, prev])
      start = sorted[i]
    }
    prev = sorted[i]
  }
  hunkRanges.push([start, prev])

  return hunkRanges.map(([lo, hi]) => {
    const hunkOps = ops.slice(lo, hi + 1)
    const diffLines: DiffLine[] = []

    let oldLineNo = (hunkOps.find((o) => o.op !== "insert") as { op: "equal" | "delete"; oldIdx: number } | undefined)?.oldIdx ?? 0
    let newLineNo = (hunkOps.find((o) => o.op !== "delete") as { op: "equal" | "insert"; newIdx: number } | undefined)?.newIdx ?? 0

    // Track running counters
    let curOld = oldLineNo
    let curNew = newLineNo

    for (const op of hunkOps) {
      if (op.op === "equal") {
        diffLines.push({ type: "context", content: oldLines[op.oldIdx], oldLineNo: op.oldIdx + 1, newLineNo: op.newIdx + 1 })
        curOld = op.oldIdx + 1
        curNew = op.newIdx + 1
      } else if (op.op === "delete") {
        diffLines.push({ type: "removed", content: oldLines[op.oldIdx], oldLineNo: op.oldIdx + 1 })
        curOld = op.oldIdx + 1
      } else {
        diffLines.push({ type: "added", content: newLines[op.newIdx], newLineNo: op.newIdx + 1 })
        curNew = op.newIdx + 1
      }
    }

    // Compute hunk header counts
    const firstOld = hunkOps.find((o) => o.op !== "insert") as { oldIdx: number } | undefined
    const firstNew = hunkOps.find((o) => o.op !== "delete") as { newIdx: number } | undefined
    const oldStart = firstOld ? firstOld.oldIdx + 1 : 0
    const newStart = firstNew ? firstNew.newIdx + 1 : 0
    const oldCount = hunkOps.filter((o) => o.op !== "insert").length
    const newCount = hunkOps.filter((o) => o.op !== "delete").length

    return { oldStart, oldLines: oldCount, newStart, newLines: newCount, lines: diffLines }
  })
}

// ---------------------------------------------------------------------------
// parseDiffHunks — parse a unified diff string into DiffHunk[]
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string into structured DiffHunk[].
 * Skips header lines (---, +++, diff --git, index, etc.)
 * Returns [] for empty or non-diff input.
 */
export function parseDiffHunks(diff: string): DiffHunk[] {
  if (!diff || diff.trim() === "") return []

  const hunks: DiffHunk[] = []
  // Normalize mixed line endings
  const rawLines = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]
    const m = hunkHeaderRe.exec(line)

    if (!m) {
      i++
      continue
    }

    const oldStart = parseInt(m[1], 10)
    const oldLines = m[2] !== undefined ? parseInt(m[2], 10) : 1
    const newStart = parseInt(m[3], 10)
    const newLines = m[4] !== undefined ? parseInt(m[4], 10) : 1

    i++
    const diffLines: DiffLine[] = []
    let curOld = oldStart
    let curNew = newStart

    const expectedOld = oldLines
    const expectedNew = newLines
    let seenOld = 0
    let seenNew = 0

    while (i < rawLines.length) {
      // Stop if we've consumed all expected lines for this hunk
      if (seenOld >= expectedOld && seenNew >= expectedNew) break

      const l = rawLines[i]

      // Next hunk header — stop
      if (hunkHeaderRe.test(l)) break

      if (l.startsWith("-")) {
        diffLines.push({ type: "removed", content: l.slice(1), oldLineNo: curOld })
        curOld++
        seenOld++
      } else if (l.startsWith("+")) {
        diffLines.push({ type: "added", content: l.slice(1), newLineNo: curNew })
        curNew++
        seenNew++
      } else if (l.startsWith(" ")) {
        diffLines.push({ type: "context", content: l.slice(1), oldLineNo: curOld, newLineNo: curNew })
        curOld++
        curNew++
        seenOld++
        seenNew++
      } else if (l === "\\ No newline at end of file") {
        // skip
      } else {
        // Unexpected line — could be truncated diff, include what we have
        break
      }

      i++
    }

    hunks.push({ oldStart, oldLines, newStart, newLines, lines: diffLines })
  }

  return hunks
}
