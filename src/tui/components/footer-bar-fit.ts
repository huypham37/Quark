// Pure helpers for FooterBar's adaptive right-zone shrinking.
//
// Extracted into a .ts module (no JSX) so they can be unit-tested without
// pulling the OpenTUI/Solid JSX runtime through the test harness.
//
// Behavior contract: see specs/permission-feature.md? — no, this is documented
// in the FooterBar component header. The shrink ladder is the user-visible
// contract; tests in test/tui/footer-bar-adaptive.test.ts lock it down.

// App.tsx no longer applies horizontal padding, so the footer can use the full width.
export const APP_PADDING_X_TOTAL = 0
// Small visual breathing room between left and right zones.
export const ZONE_GAP = 2

// ---------------------------------------------------------------------------
// Path shrinking — produces an ordered list of candidate forms (largest first)
// ---------------------------------------------------------------------------

export function pathCandidates(fullPath: string): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const isHome = !!home && fullPath.startsWith(home)
  const rel = (isHome ? fullPath.slice(home.length) : fullPath).replace(/^\/+/, "")
  const segs = rel.split("/").filter(Boolean)

  const out: string[] = []
  // 1. Full path
  out.push(isHome ? "~/" + segs.join("/") : "/" + segs.join("/"))
  // 2. ~/…/last2 (only if it actually shortens)
  if (segs.length > 2) {
    out.push((isHome ? "~/…/" : "/…/") + segs.slice(-2).join("/"))
  }
  // 3. …/last2 (drop ~ prefix)
  if (segs.length >= 2) {
    out.push("…/" + segs.slice(-2).join("/"))
  }
  // 4. …/last1
  if (segs.length >= 1) {
    out.push("…/" + segs.slice(-1).join("/"))
  }
  // 5. Empty (drop cwd entirely)
  out.push("")

  // Dedupe while preserving order
  return Array.from(new Set(out))
}

// ---------------------------------------------------------------------------
// Branch shrinking — middle-truncate (keep type prefix + tail), then tail-
// truncate, then drop entirely.
// ---------------------------------------------------------------------------

export function branchCandidates(branch: string): string[] {
  if (!branch) return [""]
  const out: string[] = [branch]
  const slashIdx = branch.indexOf("/")

  if (slashIdx >= 0 && slashIdx + 1 < branch.length) {
    const prefix = branch.slice(0, slashIdx + 1) // e.g. "fix/"
    const body = branch.slice(slashIdx + 1)
    // Middle-truncate: prefix + first chunk of body + … + tail of body.
    // Try several budgets so the shrinker has options.
    for (const tailLen of [12, 8, 5]) {
      if (body.length > tailLen + 4) {
        const head = body.slice(0, Math.min(8, body.length - tailLen - 1))
        const tail = body.slice(-tailLen)
        out.push(`${prefix}${head}…${tail}`)
      }
    }
    // Last resort: just the type prefix + …
    out.push(`${prefix}…`)
  } else {
    // No slash → simple tail truncation
    if (branch.length > 10) out.push(branch.slice(0, 9) + "…")
    if (branch.length > 6) out.push(branch.slice(0, 5) + "…")
  }
  out.push("")
  return Array.from(new Set(out))
}

// ---------------------------------------------------------------------------
// Right-zone width calculation
// ---------------------------------------------------------------------------

export function rightZoneWidth(branch: string, cwd: string): number {
  // Mirrors the JSX: " <branch> · <cwd>" / " <branch>" / "<cwd>" / ""
  if (branch && cwd) return 1 /* leading space */ + branch.length + 3 /* " · " */ + cwd.length
  if (branch) return 1 + branch.length
  if (cwd) return cwd.length
  return 0
}

// Pick the first (branch, cwd) pair whose rendered width fits in `budget`.
// Order: shrink cwd while keeping full branch, then drop cwd and shrink branch.
export function pickRightZone(
  branch: string,
  cwd: string,
  budget: number,
): { branch: string; cwd: string } {
  if (budget <= 0) return { branch: "", cwd: "" }

  const paths = pathCandidates(cwd)
  const branches = branchCandidates(branch)

  // Phase 1: keep full branch, shrink cwd
  for (const p of paths) {
    const candidate = { branch: branches[0]!, cwd: p }
    if (rightZoneWidth(candidate.branch, candidate.cwd) <= budget) return candidate
  }
  // Phase 2: drop cwd, shrink branch
  for (let i = 1; i < branches.length; i++) {
    const candidate = { branch: branches[i]!, cwd: "" }
    if (rightZoneWidth(candidate.branch, candidate.cwd) <= budget) return candidate
  }
  return { branch: "", cwd: "" }
}

// ---------------------------------------------------------------------------
// Duration formatting — "Worked for X.Xs" or "Worked for Xm Ys"
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) {
    return `Worked for ${totalSec.toFixed(1)}s`
  }
  const min = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec % 60)
  return `Worked for ${min}m ${sec}s`
}

export function durationWidth(label: string): number {
  return label.length
}

// ---------------------------------------------------------------------------
// Left-zone widths — depend on which Show branch is active. The spinner was
// replaced by shimmering status text, so the status label has no glyph prefix.
// ---------------------------------------------------------------------------

export function leftWidthRunning(label: string): number {
  // label + "      " + "Esc" + " to cancel"
  return label.length + 6 + 3 + 10
}
export const LEFT_WIDTH_STEERING = "Preparing branch".length
export const LEFT_WIDTH_IDLE = 1 // single " " placeholder text
