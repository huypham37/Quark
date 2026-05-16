// progress.md parser and editor — the single-file state for /goal
//
// Format:
//
//   # Goal: <title>
//
//   ## Plan
//   - [x] **task-01**: Title
//     → AC: criteria line 1
//     → AC: criteria line 2
//     → Check: `bun test`
//   - [ ] **task-02**: Title
//     → AC: criteria
//
//   ## Explore
//   - [x] **delta-01**: Title → PASS
//   - [ ] **delta-02**: Title → FAIL (reason)
//
//   ## Meta
//   - Explore budget: 1/5
//   - Last action: 2026-05-14 15:42 UTC — message
//   - Judge: plan atomicity APPROVED
//   - Judge: goal check #1: NO

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import type { Task, Plan } from "./types"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function goalDir(slug: string): string {
  return join(process.cwd(), ".quark", "specs", "goals", slug)
}

function progressPath(slug: string): string {
  return join(goalDir(slug), "progress.md")
}

// ---------------------------------------------------------------------------
// Parse progress.md → Plan
// ---------------------------------------------------------------------------

function parseTask(lines: string[], startIdx: number, taskType: "planned" | "delta"): { task: Task; endIdx: number } | null {
  const header = lines[startIdx]!
  const checkboxMatch = header.match(/^-\s*\[([ x])\]\s+\*\*(.+?)\*\*:\s*(.*)/)

  if (!checkboxMatch) return null

  const checked = checkboxMatch[1] === "x"
  const id = checkboxMatch[2]!.trim()
  const title = checkboxMatch[3]!.trim()

  const ac: string[] = []
  let checkCommand: string | undefined
  let failReason: string | undefined
  let status: Task["status"] = checked ? "pass" : "pending"

  // For explore deltas, the header line may contain status like "→ PASS" or "→ FAIL (reason)"
  if (taskType === "delta") {
    const statusMatch = title.match(/^(.+?)\s*→\s*(PASS|FAIL(?:\s*\((.+)\))?)\s*$/)
    if (statusMatch) {
      const cleanTitle = statusMatch[1]!.trim()
      const result = statusMatch[2]!
      failReason = statusMatch[3]?.trim()
      // Update the title to be clean and status from the line
      // We'll reconstruct the full object below
      status = result === "PASS" ? "pass" : "fail"
      // Reconstruct header without the status suffix
      const cleanHeader = header.replace(/\s*→\s*(PASS|FAIL).*$/, "")
      return parseTaskFromClean(lines, startIdx, taskType, cleanHeader, id, cleanTitle, ac, checkCommand, failReason, status)
    }
  }

  // Read continuation lines (→ AC:, → Check:)
  let i = startIdx + 1
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith("→ AC:")) {
      ac.push(line.replace("→ AC:", "").trim())
    } else if (line.startsWith("→ Check:")) {
      checkCommand = line.replace("→ Check:", "").trim()
      // Strip backticks
      checkCommand = checkCommand.replace(/^`|`$/g, "")
    } else if (line.startsWith("→ FAIL")) {
      failReason = line.replace("→ FAIL", "").trim()
      if (failReason.startsWith("(") && failReason.endsWith(")")) {
        failReason = failReason.slice(1, -1)
      }
      status = "fail"
    } else if (line.startsWith("- [") || line.startsWith("## ") || line.startsWith("# ")) {
      break
    }
    i++
  }

  return {
    task: {
      task_type: taskType,
      id,
      title: title.includes("→") ? title.split("→")[0]!.trim() : title,
      objective: title.includes("→") ? title.split("→")[0]!.trim() : title,
      acceptance_criteria: ac,
      check_command: checkCommand,
      status,
      fail_reason: failReason,
    },
    endIdx: i,
  }
}

// Helper used when we've already parsed the status from a delta line
function parseTaskFromClean(
  _lines: string[], _startIdx: number, taskType: "planned" | "delta",
  _header: string, id: string, title: string,
  ac: string[], checkCommand: string | undefined,
  failReason: string | undefined, status: Task["status"],
): { task: Task; endIdx: number } {
  // Read continuation lines
  let i = _startIdx + 1
  while (i < _lines.length) {
    const line = _lines[i]!
    if (line.startsWith("→ AC:")) {
      ac.push(line.replace("→ AC:", "").trim())
    } else if (line.startsWith("→ Check:")) {
      checkCommand = line.replace("→ Check:", "").trim().replace(/^`|`$/g, "")
    } else if (line.startsWith("- [") || line.startsWith("## ") || line.startsWith("# ")) {
      break
    }
    i++
  }

  return {
    task: {
      task_type: taskType,
      id,
      title,
      objective: title,
      acceptance_criteria: ac,
      check_command: checkCommand,
      status,
      fail_reason: failReason,
    },
    endIdx: i,
  }
}

export function parsePlan(slug: string): Plan {
  const plan: Plan = {
    tasks: [],
    deltas: [],
    meta: { exploreBudgetUsed: 0, exploreBudgetMax: 5, lastAction: "", judgeVerdicts: [] },
  }

  const p = progressPath(slug)
  if (!existsSync(p)) return plan

  const content = readFileSync(p, "utf-8")
  const lines = content.split("\n")

  let section: "plan" | "explore" | "meta" | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (line.startsWith("## Plan")) { section = "plan"; continue }
    if (line.startsWith("## Explore")) { section = "explore"; continue }
    if (line.startsWith("## Meta")) { section = "meta"; continue }
    if (line.startsWith("# ")) { section = null; continue }

    if (section === "plan" && line.startsWith("- [")) {
      const result = parseTask(lines, i, "planned")
      if (result) {
        plan.tasks.push(result.task)
        i = result.endIdx - 1
      }
    } else if (section === "explore" && line.startsWith("- [")) {
      const result = parseTask(lines, i, "delta")
      if (result) {
        plan.deltas.push(result.task)
        i = result.endIdx - 1
      }
    } else if (section === "meta") {
      if (line.startsWith("- Explore budget:")) {
        const m = line.match(/(\d+)\/(\d+)/)
        if (m) {
          plan.meta.exploreBudgetUsed = parseInt(m[1]!, 10)
          plan.meta.exploreBudgetMax = parseInt(m[2]!, 10)
        }
      } else if (line.startsWith("- Last action:")) {
        plan.meta.lastAction = line.replace("- Last action:", "").trim()
      } else if (line.startsWith("- Judge:")) {
        plan.meta.judgeVerdicts.push(line.replace("- Judge:", "").trim())
      }
    }
  }

  return plan
}

// ---------------------------------------------------------------------------
// Edit progress.md
// ---------------------------------------------------------------------------

export function nextTask(plan: Plan): Task | null {
  return plan.tasks.find((t) => t.status === "pending") ?? null
}

export function pendingTasks(plan: Plan): Task[] {
  return plan.tasks.filter((t) => t.status === "pending")
}

export function remainingExploreBudget(plan: Plan): number {
  return plan.meta.exploreBudgetMax - plan.meta.exploreBudgetUsed
}

// ---------------------------------------------------------------------------
// Write progress.md
// ---------------------------------------------------------------------------

export function writePlan(slug: string, plan: Plan, goalTitle: string): void {
  const lines: string[] = []
  lines.push(`# Goal: ${goalTitle}`)
  lines.push("")

  // Plan section
  lines.push("## Plan")
  for (const task of plan.tasks) {
    const check = task.status === "pass" ? "x" : " "
    lines.push(`- [${check}] **${task.id}**: ${task.title}`)
    if (task.acceptance_criteria.length > 0) {
      for (const ac of task.acceptance_criteria) {
        lines.push(`  → AC: ${ac}`)
      }
    }
    if (task.check_command) {
      lines.push(`  → Check: \`${task.check_command}\``)
    }
    if (task.status === "fail" && task.fail_reason) {
      lines.push(`  → FAIL (${task.fail_reason})`)
    }
  }
  lines.push("")

  // Explore section
  lines.push("## Explore")
  for (const delta of plan.deltas) {
    const check = delta.status === "pass" ? "x" : " "
    const statusSuffix = delta.status === "pass"
      ? " → PASS"
      : delta.status === "fail"
        ? ` → FAIL${delta.fail_reason ? ` (${delta.fail_reason})` : ""}`
        : ""
    lines.push(`- [${check}] **${delta.id}**: ${delta.title}${statusSuffix}`)
    if (delta.acceptance_criteria.length > 0) {
      for (const ac of delta.acceptance_criteria) {
        lines.push(`  → AC: ${ac}`)
      }
    }
  }
  lines.push("")

  // Meta section
  lines.push("## Meta")
  lines.push(`- Explore budget: ${plan.meta.exploreBudgetUsed}/${plan.meta.exploreBudgetMax}`)
  lines.push(`- Last action: ${plan.meta.lastAction}`)
  for (const verdict of plan.meta.judgeVerdicts) {
    lines.push(`- Judge: ${verdict}`)
  }

  const dir = goalDir(slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(progressPath(slug), lines.join("\n") + "\n")
}

export function markTaskDone(slug: string, plan: Plan, taskId: string, goalTitle: string): void {
  const task = plan.tasks.find((t) => t.id === taskId)
  if (task) {
    task.status = "pass"
    plan.meta.lastAction = `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC — ${taskId} passed`
  }
  writePlan(slug, plan, goalTitle)
}

export function markTaskFailed(slug: string, plan: Plan, taskId: string, reason: string, goalTitle: string): void {
  const task = plan.tasks.find((t) => t.id === taskId)
  if (task) {
    task.status = "fail"
    task.fail_reason = reason
    plan.meta.lastAction = `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC — ${taskId} failed: ${reason}`
  }
  writePlan(slug, plan, goalTitle)
}

export function appendDelta(slug: string, plan: Plan, delta: Task, goalTitle: string): void {
  plan.deltas.push(delta)
  if (delta.status !== "pending") {
    plan.meta.exploreBudgetUsed++
  }
  plan.meta.lastAction = `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC — ${delta.id} ${delta.status === "pass" ? "passed" : "failed"}`
  writePlan(slug, plan, goalTitle)
}

export function addJudgeVerdict(slug: string, plan: Plan, verdict: string, goalTitle: string): void {
  plan.meta.judgeVerdicts.push(verdict)
  writePlan(slug, plan, goalTitle)
}

export function progressPathFor(slug: string): string {
  return progressPath(slug)
}
