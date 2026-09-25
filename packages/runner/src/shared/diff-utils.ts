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

export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  if (oldContent === newContent) return ""

  const oldLines = oldContent === "" ? [] : oldContent.replace(/\r\n/g, "\n").split("\n")
  const newLines = newContent === "" ? [] : newContent.replace(/\r\n/g, "\n").split("\n")
  const hunks = buildHunks(myersDiff(oldLines, newLines), oldLines, newLines, 3)

  if (hunks.length === 0) return ""

  const oldHeader = oldContent === "" ? "--- /dev/null" : `--- a/${filePath}`
  const newHeader = newContent === "" ? "+++ /dev/null" : `+++ b/${filePath}`
  const lines: string[] = [oldHeader, newHeader]

  for (const hunk of hunks) {
    const oldCount = hunk.oldLines === 1 ? "1" : `${hunk.oldStart === 0 ? 0 : hunk.oldStart},${hunk.oldLines}`
    const newCount = hunk.newLines === 1 ? "1" : `${hunk.newStart === 0 ? 0 : hunk.newStart},${hunk.newLines}`
    lines.push(`@@ -${oldCount} +${newCount} @@`)

    for (const dl of hunk.lines) {
      if (dl.type === "context") lines.push(" " + dl.content)
      else if (dl.type === "added") lines.push("+" + dl.content)
      else lines.push("-" + dl.content)
    }
  }

  return lines.join("\n")
}

type EditOp =
  | { op: "equal"; oldIdx: number; newIdx: number }
  | { op: "insert"; newIdx: number }
  | { op: "delete"; oldIdx: number }

function myersDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const N = oldLines.length
  const M = newLines.length

  if (N === 0) return newLines.map((_, i) => ({ op: "insert" as const, newIdx: i }))
  if (M === 0) return oldLines.map((_, i) => ({ op: "delete" as const, oldIdx: i }))

  const MAX = N + M
  const v: number[] = new Array(2 * MAX + 1).fill(0)
  const trace: number[][] = []

  outer: for (let d = 0; d <= MAX; d++) {
    trace.push([...v])
    for (let k = -d; k <= d; k += 2) {
      const ki = k + MAX
      const left = v[ki - 1] ?? 0
      const right = v[ki + 1] ?? 0
      let x = k === -d || (k !== d && left < right) ? right : left + 1
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

  const ops: EditOp[] = []
  let x = N
  let y = M

  for (let d = trace.length - 1; d >= 1; d--) {
    const prev = trace[d - 1]!
    const k = x - y
    const ki = k + MAX
    const left = prev[ki - 1] ?? 0
    const right = prev[ki + 1] ?? 0
    const prevK = k === -d + 1 || (k !== d - 1 && left < right) ? k + 1 : k - 1
    const prevX = prev[prevK + MAX] ?? 0
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

  while (x > 0 && y > 0) {
    x--
    y--
    ops.unshift({ op: "equal", oldIdx: x, newIdx: y })
  }

  return ops
}

function buildHunks(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[],
  context: number,
): DiffHunk[] {
  if (ops.length === 0) return []

  const changeAt = new Set<number>()
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]?.op !== "equal") changeAt.add(i)
  }
  if (changeAt.size === 0) return []

  const include = new Set<number>()
  for (const ci of changeAt) {
    for (let j = Math.max(0, ci - context); j <= Math.min(ops.length - 1, ci + context); j++) {
      include.add(j)
    }
  }

  const sorted = [...include].sort((a, b) => a - b)
  if (sorted.length === 0) return []

  const hunkRanges: Array<[number, number]> = []
  let start = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    const idx = sorted[i]!
    if (idx !== prev + 1) {
      hunkRanges.push([start, prev])
      start = idx
    }
    prev = idx
  }
  hunkRanges.push([start, prev])

  return hunkRanges.map(([lo, hi]) => {
    const hunkOps = ops.slice(lo, hi + 1)
    const diffLines: DiffLine[] = []

    for (const op of hunkOps) {
      if (op.op === "equal") {
        diffLines.push({
          type: "context",
          content: oldLines[op.oldIdx] ?? "",
          oldLineNo: op.oldIdx + 1,
          newLineNo: op.newIdx + 1,
        })
      } else if (op.op === "delete") {
        diffLines.push({
          type: "removed",
          content: oldLines[op.oldIdx] ?? "",
          oldLineNo: op.oldIdx + 1,
        })
      } else {
        diffLines.push({
          type: "added",
          content: newLines[op.newIdx] ?? "",
          newLineNo: op.newIdx + 1,
        })
      }
    }

    const firstOld = hunkOps.find((o) => o.op !== "insert") as { oldIdx: number } | undefined
    const firstNew = hunkOps.find((o) => o.op !== "delete") as { newIdx: number } | undefined
    const oldStart = firstOld ? firstOld.oldIdx + 1 : 0
    const newStart = firstNew ? firstNew.newIdx + 1 : 0
    const oldCount = hunkOps.filter((o) => o.op !== "insert").length
    const newCount = hunkOps.filter((o) => o.op !== "delete").length

    return { oldStart, oldLines: oldCount, newStart, newLines: newCount, lines: diffLines }
  })
}

export function parseDiffHunks(diff: string): DiffHunk[] {
  if (!diff || diff.trim() === "") return []

  const hunks: DiffHunk[] = []
  const rawLines = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i] ?? ""
    const m = hunkHeaderRe.exec(line)

    if (!m) {
      i++
      continue
    }

    const oldStart = parseInt(m[1]!, 10)
    const oldLines = m[2] !== undefined ? parseInt(m[2], 10) : 1
    const newStart = parseInt(m[3]!, 10)
    const newLines = m[4] !== undefined ? parseInt(m[4], 10) : 1

    i++
    const diffLines: DiffLine[] = []
    let curOld = oldStart
    let curNew = newStart
    let seenOld = 0
    let seenNew = 0

    while (i < rawLines.length) {
      if (seenOld >= oldLines && seenNew >= newLines) break

      const l = rawLines[i] ?? ""
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
        diffLines.push({
          type: "context",
          content: l.slice(1),
          oldLineNo: curOld,
          newLineNo: curNew,
        })
        curOld++
        curNew++
        seenOld++
        seenNew++
      } else if (l !== "\\ No newline at end of file") {
        break
      }

      i++
    }

    hunks.push({ oldStart, oldLines, newStart, newLines, lines: diffLines })
  }

  return hunks
}
