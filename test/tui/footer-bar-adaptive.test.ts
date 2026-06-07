// Tests for the adaptive right-zone shrinking in FooterBar.
//
// Scope: pure helpers exported via __test from src/tui/components/footer-bar.tsx
//   1. pathCandidates       — produces a sensible shrink ladder
//   2. branchCandidates     — middle-truncate then tail-truncate
//   3. rightZoneWidth       — accounts for separator
//   4. pickRightZone        — picks the first candidate that fits
//   5. leftWidthRunning     — varies with label length
//
// The shrink ladder is the user-visible behavior; we lock it down here so
// future refactors can't silently change what users see at any given width.

import { describe, test, expect } from "bun:test"
import {
  pathCandidates,
  branchCandidates,
  rightZoneWidth,
  pickRightZone,
  leftWidthRunning,
  LEFT_WIDTH_STEERING,
  LEFT_WIDTH_IDLE,
  formatDuration,
  durationWidth,
} from "../../src/tui/components/footer-bar-fit"

// ---------------------------------------------------------------------------
// pathCandidates
// ---------------------------------------------------------------------------

describe("pathCandidates()", () => {
  test("1. produces full → ~/…/last2 → …/last2 → …/last1 → '' for a deep home path", () => {
    const home = process.env.HOME ?? "/Users/test"
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      const p = `${home}/01-CodeSpace/Personal-Lab/02-Experiment/Quark/specs`
      const list = pathCandidates(p)
      expect(list).toEqual([
        "~/01-CodeSpace/Personal-Lab/02-Experiment/Quark/specs",
        "~/…/Quark/specs",
        "…/Quark/specs",
        "…/specs",
        "",
      ])
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })

  test("2. dedupes when there's nothing to shrink (path with one segment under home)", () => {
    const home = process.env.HOME ?? "/Users/test"
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      const list = pathCandidates(`${home}/Quark`)
      // Full = "~/Quark", no ~/…/ form (only 1 segment), …/Quark, then ""
      expect(list[0]).toBe("~/Quark")
      expect(list).toContain("…/Quark")
      expect(list[list.length - 1]).toBe("")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })

  test("3. handles non-home absolute paths (no ~ prefix)", () => {
    const orig = process.env.HOME
    process.env.HOME = "/Users/somebody-else"
    try {
      const list = pathCandidates("/etc/nginx/sites-available/default")
      expect(list[0]).toBe("/etc/nginx/sites-available/default")
      expect(list).toContain("/…/sites-available/default")
      expect(list).toContain("…/sites-available/default")
      expect(list).toContain("…/default")
      expect(list[list.length - 1]).toBe("")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })
})

// ---------------------------------------------------------------------------
// branchCandidates
// ---------------------------------------------------------------------------

describe("branchCandidates()", () => {
  test("4. typed branch produces middle-truncated forms keeping prefix and tail", () => {
    const list = branchCandidates("fix/gh-135-sub-agent-tui-redesign")
    expect(list[0]).toBe("fix/gh-135-sub-agent-tui-redesign")
    // Every shrunk form must start with the type prefix
    for (const c of list) {
      if (c === "" || c === list[0]) continue
      expect(c.startsWith("fix/")).toBe(true)
      expect(c).toContain("…")
    }
    // Last meaningful form is the prefix stub
    expect(list).toContain("fix/…")
    expect(list[list.length - 1]).toBe("")
  })

  test("5. middle-truncated forms preserve a recognizable tail", () => {
    const list = branchCandidates("fix/gh-135-sub-agent-tui-redesign")
    // At least one mid-truncated form must end with the actual branch tail
    const midForms = list.filter((c) => c.includes("…") && c !== "fix/…")
    expect(midForms.length).toBeGreaterThan(0)
    expect(midForms.some((c) => c.endsWith("redesign"))).toBe(true)
  })

  test("6. plain branch (no slash) tail-truncates", () => {
    const list = branchCandidates("very-long-branch-name")
    expect(list[0]).toBe("very-long-branch-name")
    expect(list.some((c) => c.endsWith("…") && c.length < list[0]!.length)).toBe(true)
    expect(list[list.length - 1]).toBe("")
  })

  test("7. empty branch returns only ['']", () => {
    expect(branchCandidates("")).toEqual([""])
  })

  test("8. short branch isn't middle-truncated (no need)", () => {
    const list = branchCandidates("main")
    // Only "main" and "" — nothing to shrink
    expect(list).toEqual(["main", ""])
  })
})

// ---------------------------------------------------------------------------
// rightZoneWidth
// ---------------------------------------------------------------------------

describe("rightZoneWidth()", () => {
  test("9. counts leading space + branch + ' · ' + cwd when both present", () => {
    // " main · ~/x" → 1 + 4 + 3 + 3 = 11
    expect(rightZoneWidth("main", "~/x")).toBe(1 + 4 + 3 + 3)
  })

  test("10. counts leading space + branch only when cwd is empty", () => {
    expect(rightZoneWidth("main", "")).toBe(1 + 4)
  })

  test("11. counts cwd alone when branch is empty (no leading space)", () => {
    expect(rightZoneWidth("", "~/x")).toBe(3)
  })

  test("12. zero when both empty", () => {
    expect(rightZoneWidth("", "")).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pickRightZone — the user-visible shrink behavior
// ---------------------------------------------------------------------------

describe("pickRightZone()", () => {
  const home = process.env.HOME ?? "/Users/test"
  const cwd = `${home}/01-CodeSpace/Personal-Lab/02-Experiment/Quark/specs`
  const branch = "fix/gh-135-sub-agent-tui-redesign"

  test("13. wide budget keeps full branch and full cwd", () => {
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      const r = pickRightZone(branch, cwd, 200)
      expect(r.branch).toBe(branch)
      expect(r.cwd).toBe("~/01-CodeSpace/Personal-Lab/02-Experiment/Quark/specs")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })

  test("14. shrinks cwd before touching branch", () => {
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      // Budget tight enough to drop full cwd but keep full branch + ~/…/Quark/specs
      // " fix/gh-135-sub-agent-tui-redesign · ~/…/Quark/specs"
      // = 1 + 33 + 3 + 16 = 53
      const r = pickRightZone(branch, cwd, 53)
      expect(r.branch).toBe(branch)
      expect(r.cwd).toBe("~/…/Quark/specs")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })

  test("15. drops cwd entirely before truncating branch", () => {
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      // " fix/gh-135-sub-agent-tui-redesign" = 1 + 33 = 34
      // Budget 36 → no room for any cwd form → drop cwd, keep full branch
      const r = pickRightZone(branch, cwd, 36)
      expect(r.branch).toBe(branch)
      expect(r.cwd).toBe("")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })

  test("16. truncates branch when even the bare branch doesn't fit", () => {
    const r = pickRightZone(branch, cwd, 20)
    expect(r.cwd).toBe("")
    // Either truncated form, but must be shorter than full branch
    expect(r.branch.length).toBeLessThan(branch.length)
    // Always retains the type prefix as long as anything renders
    if (r.branch) expect(r.branch.startsWith("fix/")).toBe(true)
  })

  test("17. zero/negative budget renders nothing", () => {
    expect(pickRightZone(branch, cwd, 0)).toEqual({ branch: "", cwd: "" })
    expect(pickRightZone(branch, cwd, -5)).toEqual({ branch: "", cwd: "" })
  })

  test("18. result always fits within the given budget", () => {
    // Property test: pick across a range of budgets and verify the invariant
    for (let budget = 0; budget < 120; budget++) {
      const r = pickRightZone(branch, cwd, budget)
      expect(rightZoneWidth(r.branch, r.cwd)).toBeLessThanOrEqual(Math.max(0, budget))
    }
  })

  test("19. shrinking is monotonic — larger budgets never produce a worse result", () => {
    // Width should be non-decreasing as budget grows
    let prev = 0
    for (let budget = 0; budget < 120; budget++) {
      const r = pickRightZone(branch, cwd, budget)
      const w = rightZoneWidth(r.branch, r.cwd)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
  })

  test("20. handles empty branch (not in a git repo) — only cwd shrinks", () => {
    const orig = process.env.HOME
    process.env.HOME = home
    try {
      const r = pickRightZone("", cwd, 20)
      expect(r.branch).toBe("")
      expect(r.cwd.length).toBeLessThanOrEqual(20)
      // Wide budget gives full cwd back
      const wide = pickRightZone("", cwd, 200)
      expect(wide.cwd).toBe("~/01-CodeSpace/Personal-Lab/02-Experiment/Quark/specs")
    } finally {
      if (orig === undefined) delete process.env.HOME
      else process.env.HOME = orig
    }
  })
})

// ---------------------------------------------------------------------------
// Left-zone widths
// ---------------------------------------------------------------------------

describe("left zone widths", () => {
  test("21. running left width grows with the label (no spinner prefix)", () => {
    // label + "      "(6) + "Esc"(3) + " to cancel"(10) = label + 19
    // "Working" (7) → 26
    expect(leftWidthRunning("Working")).toBe(26)
    // "Streaming" (9) → 28
    expect(leftWidthRunning("Streaming")).toBe(28)
    // "Channelling…" (12) → 31
    expect(leftWidthRunning("Channelling…")).toBe(31)
  })

  test("22. steering and idle widths are constants matching the rendered text", () => {
    // Shimmering "Steering context" — no spinner prefix
    expect(LEFT_WIDTH_STEERING).toBe("Steering context".length)
    // Idle is a single space placeholder
    expect(LEFT_WIDTH_IDLE).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// formatDuration / durationWidth
// ---------------------------------------------------------------------------

describe("formatDuration()", () => {
  test("23. < 60s formats as 'Worked for X.Xs' with one decimal", () => {
    expect(formatDuration(500)).toBe("Worked for 0.5s")
    expect(formatDuration(1000)).toBe("Worked for 1.0s")
    expect(formatDuration(1234)).toBe("Worked for 1.2s")
    expect(formatDuration(59999)).toBe("Worked for 60.0s")
  })

  test("24. >= 60s formats as 'Worked for Xm Ys'", () => {
    expect(formatDuration(60000)).toBe("Worked for 1m 0s")
    expect(formatDuration(90000)).toBe("Worked for 1m 30s")
    expect(formatDuration(125000)).toBe("Worked for 2m 5s")
    expect(formatDuration(3661000)).toBe("Worked for 61m 1s")
  })

  test("25. seconds are rounded in minute format", () => {
    expect(formatDuration(60500)).toBe("Worked for 1m 1s")
    expect(formatDuration(60900)).toBe("Worked for 1m 1s")
    expect(formatDuration(150100)).toBe("Worked for 2m 30s")
  })
})

describe("durationWidth()", () => {
  test("26. returns the label length exactly", () => {
    expect(durationWidth("Worked for 1.2s")).toBe("Worked for 1.2s".length)
    expect(durationWidth("Worked for 2m 5s")).toBe("Worked for 2m 5s".length)
  })
})
