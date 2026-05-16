// /goal orchestrator — outer loop: plan → execute → verify → judge → explore
//
// Composes on top of prompt() — no changes to the existing agent loop.
// Each task gets a fresh prompt() call with clean context.

import { resolveProfile, readPromptFile } from "../../profile/profile"
import { agentFromProfile } from "../../agent"
import type { AgentConfig } from "../../agent"
import { prompt } from "../../session/prompt"
import { loadConfig } from "../../config/config"
import type { Task, Plan } from "./types"
import {
  parsePlan,
  writePlan,
  nextTask,
  markTaskDone,
  markTaskFailed,
  appendDelta,
  addJudgeVerdict,
  remainingExploreBudget,
  progressPathFor,
} from "./plan"
import { runCheck, judgeAtomicity, judgeGoal } from "./verify"
import { debug } from "../../debug"

const dlog = debug("goal")

// ---------------------------------------------------------------------------
// Agent construction
// ---------------------------------------------------------------------------

function goalAgent(): AgentConfig {
  const cfg = loadConfig()
  const profileId = cfg.goal?.executor_profile ?? "coder"
  const profile = resolveProfile(profileId)
  const promptResult = readPromptFile(profile)
  const base = agentFromProfile(profile, promptResult.content)

  // Auto-approve all tools — goal mode runs without permission prompts
  const autoAllow = [{ tool: "*", action: "allow" as const }]

  return {
    ...base,
    permissions: autoAllow,
  }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

async function generatePlan(goalText: string, slug: string): Promise<Plan> {
  const agent = goalAgent()
  const cfg = loadConfig()
  const maxTasks = cfg.goal?.max_planned_tasks ?? 20

  const planPrompt = [
    `You are planning how to achieve this goal: "${goalText}"`,
    "",
    "Create a plan with small, atomic, independently verifiable tasks.",
    `Maximum ${maxTasks} tasks. Each task must:`,
    "1. Have a clear objective (one thing to do)",
    "2. Have acceptance criteria (how to verify it's done)",
    "3. Have a deterministic check command (shell command, exit 0 = pass)",
    "",
    "Output the plan as a markdown file at:",
    progressPathFor(slug),
    "",
    "Use this exact format:",
    "```",
    "# Goal: " + goalText,
    "",
    "## Plan",
    "- [ ] **task-01**: Short title",
    "  → AC: acceptance criteria",
    "  → Check: `bun test src/...`",
    "- [ ] **task-02**: Another task",
    "  → AC: criteria",
    "  → Check: `tsc --noEmit`",
    "",
    "## Explore",
    "",
    "## Meta",
    "- Explore budget: 0/5",
    "- Last action: plan generated",
    "```",
    "",
    "IMPORTANT: Write the file to the exact path shown above. Do NOT implement anything — plan only.",
  ].join("\n")

  dlog("generating plan...")
  await prompt({
    parts: [{ type: "text", text: planPrompt }],
    agent,
  })

  const plan = parsePlan(slug)
  dlog(`plan generated: ${plan.tasks.length} tasks`)
  return plan
}

// ---------------------------------------------------------------------------
// Explore delta generation
// ---------------------------------------------------------------------------

async function generateDelta(goalText: string, planText: string): Promise<Task | null> {
  const agent = goalAgent()

  const deltaPrompt = [
    "You are in EXPLORE MODE. The plan is exhausted but the goal is not yet achieved.",
    "",
    "Goal: " + goalText,
    "",
    "Progress so far:",
    planText,
    "",
    "Generate ONE atomic delta task — a small, specific action that moves us closer to the goal.",
    "DO NOT repeat anything already marked as done.",
    "Output ONLY the task in this format:",
    "",
    "### Delta: Short title",
    "**Objective:** One-sentence description of what to do.",
    "**AC:** acceptance criteria",
    "**Check:** `shell command`",
    "",
    "Be specific. The delta must be verifiable with a shell command.",
  ].join("\n")

  dlog("generating delta...")
  await prompt({
    parts: [{ type: "text", text: deltaPrompt }],
    agent,
  })

  // The agent wrote its response as text — we'd need to parse it.
  // For now, return null to signal "can't parse, try again."
  // In practice, the agent will also write files, and the check command
  // verifies the result. We can extract the delta from the response text.
  //
  // TODO: extract delta from agent output text
  return null
}

// ---------------------------------------------------------------------------
// Plan text for judge context
// ---------------------------------------------------------------------------

function planSummary(plan: Plan, goalTitle: string): string {
  const lines: string[] = [`# Goal: ${goalTitle}`, ""]

  lines.push("## Plan")
  for (const t of plan.tasks) {
    const icon = t.status === "pass" ? "✅" : t.status === "fail" ? "❌" : "⬜"
    lines.push(`- ${icon} **${t.id}**: ${t.title}`)
  }

  if (plan.deltas.length > 0) {
    lines.push("")
    lines.push("## Explore")
    for (const d of plan.deltas) {
      const icon = d.status === "pass" ? "✅" : d.status === "fail" ? "❌" : "⬜"
      lines.push(`- ${icon} **${d.id}**: ${d.title}`)
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Main orchestrator entry point
// ---------------------------------------------------------------------------

export interface GoalOptions {
  /** The user's goal text */
  goal: string
  /** Model override for task execution */
  model?: string
  /** Resume an existing goal by slug */
  resume?: string
}

export async function runGoal(opts: GoalOptions): Promise<{ done: boolean; slug: string }> {
  const slug = opts.resume ?? slugify(opts.goal)
  const cfg = loadConfig()
  const exploreBudgetMax = cfg.goal?.explore_budget ?? 5

  dlog(`starting goal: "${opts.goal}" slug=${slug}`)

  // Phase 1: Generate plan (or resume)
  let plan: Plan
  if (opts.resume) {
    plan = parsePlan(slug)
    if (plan.tasks.length === 0) {
      dlog("no existing plan found, generating new one")
      plan = await generatePlan(opts.goal, slug)
    } else {
      dlog(`resumed plan: ${plan.tasks.length} tasks, ${plan.deltas.length} deltas`)
    }
  } else {
    plan = await generatePlan(opts.goal, slug)
  }

  // Phase 2: Judge atomicity
  dlog("judging atomicity...")
  const planText = planSummary(plan, opts.goal)
  const atomicityResult = await judgeAtomicity(planText)
  plan.meta.exploreBudgetMax = exploreBudgetMax
  writePlan(slug, plan, opts.goal)

  if (!atomicityResult.pass) {
    dlog(`atomicity FAIL: ${atomicityResult.reason}`)
    addJudgeVerdict(slug, plan, `plan atomicity: NO — ${atomicityResult.reason}`, opts.goal)
    // Regenerate plan — the judge feedback guides the next attempt
    plan = await generatePlan(
      `${opts.goal}\n\nPrevious plan was rejected by the judge: ${atomicityResult.reason}`,
      slug,
    )
    // Re-judge (single retry)
    const retryText = planSummary(plan, opts.goal)
    const retryResult = await judgeAtomicity(retryText)
    if (!retryResult.pass) {
      dlog("atomicity still FAIL on retry, proceeding anyway")
    }
  } else {
    dlog("atomicity PASS")
    addJudgeVerdict(slug, plan, "plan atomicity: APPROVED", opts.goal)
  }

  // Phase 3: Task loop
  const agent = goalAgent()
  let task = nextTask(plan)

  while (task) {
    dlog(`executing ${task.id}: ${task.title}`)

    // Build task prompt
    const taskPrompt = [
      `Complete this task: ${task.title}`,
      "",
      task.objective,
      "",
      "Acceptance criteria:",
      ...task.acceptance_criteria.map((ac) => `- ${ac}`),
      task.check_command
        ? `\nAfter completing, verify with: \`${task.check_command}\``
        : "",
    ].join("\n")

    try {
      await prompt({
        parts: [{ type: "text", text: taskPrompt }],
        agent,
        model: opts.model,
      })
    } catch (err) {
      dlog(`task ${task.id} error: ${err instanceof Error ? err.message : String(err)}`)
      markTaskFailed(slug, plan, task.id, `Agent error: ${err instanceof Error ? err.message : String(err)}`, opts.goal)
      plan = parsePlan(slug)
      task = nextTask(plan)
      continue
    }

    // Deterministic verification
    if (task.check_command) {
      const check = runCheck(task.check_command)
      if (check.pass) {
        dlog(`${task.id} check PASS`)
        markTaskDone(slug, plan, task.id, opts.goal)
      } else {
        dlog(`${task.id} check FAIL: ${check.output.slice(0, 200)}`)
        markTaskFailed(slug, plan, task.id, check.output.slice(0, 500), opts.goal)
      }
    } else {
      // No check command — mark done (trust the agent)
      markTaskDone(slug, plan, task.id, opts.goal)
    }

    // Re-parse plan (it was mutated by markTaskDone/markTaskFailed)
    plan = parsePlan(slug)
    task = nextTask(plan)
  }

  dlog("all plan tasks complete, calling final judge")

  // Phase 4: Final judge
  const finalPlanText = planSummary(plan, opts.goal)
  const cfg2 = loadConfig()
  const judgeModel = cfg2.goal?.judge_model
  const finalResult = await judgeGoal(opts.goal, finalPlanText)

  if (finalResult.pass) {
    dlog("final judge: GOAL MET")
    addJudgeVerdict(slug, plan, `goal check: YES — ${finalResult.reason}`, opts.goal)
    return { done: true, slug }
  }

  dlog(`final judge: NOT MET — ${finalResult.reason}`)
  addJudgeVerdict(slug, plan, `goal check #1: NO — ${finalResult.reason}`, opts.goal)
  plan = parsePlan(slug)

  // Phase 5: Explore mode
  dlog("entering explore mode")
  let budgetUsed = plan.meta.exploreBudgetUsed

  while (remainingExploreBudget(plan) > 0) {
    dlog(`explore iteration ${budgetUsed + 1}/${exploreBudgetMax}`)

    // Generate delta task
    const planTextForDelta = planSummary(plan, opts.goal)
    const delta = await generateDelta(opts.goal, planTextForDelta)

    if (!delta) {
      dlog("delta generation returned null, retrying")
      budgetUsed++
      plan.meta.exploreBudgetUsed = budgetUsed
      writePlan(slug, plan, opts.goal)
      continue
    }

    // Execute delta
    const deltaPrompt = [
      `Complete this delta task: ${delta.title}`,
      "",
      delta.objective,
      "",
      "Acceptance criteria:",
      ...delta.acceptance_criteria.map((ac) => `- ${ac}`),
      delta.check_command
        ? `\nAfter completing, verify with: \`${delta.check_command}\``
        : "",
    ].join("\n")

    try {
      await prompt({
        parts: [{ type: "text", text: deltaPrompt }],
        agent,
        model: opts.model,
      })
    } catch (err) {
      delta.status = "fail"
      delta.fail_reason = `Agent error: ${err instanceof Error ? err.message : String(err)}`
      appendDelta(slug, plan, delta, opts.goal)
      budgetUsed++
      plan.meta.exploreBudgetUsed = budgetUsed
      plan = parsePlan(slug)
      continue
    }

    // Verify delta
    if (delta.check_command) {
      const check = runCheck(delta.check_command)
      if (check.pass) {
        delta.status = "pass"
        appendDelta(slug, plan, delta, opts.goal)
        budgetUsed++
        plan.meta.exploreBudgetUsed = budgetUsed

        // Delta passed — re-judge the goal
        const recheckText = planSummary(plan, opts.goal)
        const recheckResult = await judgeGoal(opts.goal, recheckText)
        if (recheckResult.pass) {
          dlog("goal met after delta!")
          addJudgeVerdict(slug, plan, `goal check: YES — ${recheckResult.reason}`, opts.goal)
          return { done: true, slug }
        }
        addJudgeVerdict(slug, plan, `goal check: still NO — ${recheckResult.reason}`, opts.goal)
        plan = parsePlan(slug)
      } else {
        delta.status = "fail"
        delta.fail_reason = check.output.slice(0, 500)
        appendDelta(slug, plan, delta, opts.goal)
        budgetUsed++
        plan.meta.exploreBudgetUsed = budgetUsed
        plan = parsePlan(slug)
      }
    } else {
      delta.status = "pass"
      appendDelta(slug, plan, delta, opts.goal)
      budgetUsed++
      plan.meta.exploreBudgetUsed = budgetUsed
      plan = parsePlan(slug)
    }
  }

  dlog("explore budget exhausted, reporting partial")
  addJudgeVerdict(slug, plan, "explore budget exhausted — GOAL NOT MET", opts.goal)
  return { done: false, slug }
}
