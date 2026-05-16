// Verification — deterministic checks and LLM judge calls for /goal

import { execSync } from "node:child_process"
import { generateText, type LanguageModel } from "ai"
import { resolveModel } from "../../session/prompt"
import { loadConfig } from "../../config/config"

// ---------------------------------------------------------------------------
// Deterministic check — run a shell command, exit 0 = PASS
// ---------------------------------------------------------------------------

export interface CheckResult {
  pass: boolean
  output: string
}

export function runCheck(command: string, cwd?: string): CheckResult {
  try {
    const output = execSync(command, {
      cwd: cwd ?? process.cwd(),
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { pass: true, output: output.trim() }
  } catch (e: any) {
    const stdout = e.stdout?.trim() ?? ""
    const stderr = e.stderr?.trim() ?? ""
    return { pass: false, output: `${stdout}\n${stderr}`.trim() || e.message }
  }
}

// ---------------------------------------------------------------------------
// Judge — LLM call for non-deterministic verification
// ---------------------------------------------------------------------------
//
// Uses generateText() from the AI SDK — no tools, no streaming, no session.
// Returns the text directly. Perfect for yes/no judge calls.

/**
 * Ask the oracle judge a yes/no question.
 * Returns true if the answer starts with YES (case-insensitive).
 */
export async function judge(
  question: string,
  context: string,
  model?: LanguageModel,
): Promise<{ pass: boolean; output: string }> {
  try {
    const resolvedModel = model ?? await resolveModel(loadConfig().small_model)
    const systemPrompt = [
      "You are a judge. Answer the following question based on the context provided.",
      "Answer ONLY with YES or NO, followed by a brief one-line reason.",
    ].join("\n")

    const result = await generateText({
      model: resolvedModel,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `Context:\n${context}\n\nQuestion:\n${question}` },
      ],
      maxRetries: 1,
    })

    const output = result.text.trim()
    const pass = /^\s*yes\b/i.test(output)
    return { pass, output }
  } catch (err) {
    return { pass: false, output: `Judge error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Judge whether the plan tasks are atomic and independently verifiable.
 */
export async function judgeAtomicity(planText: string): Promise<{ pass: boolean; reason: string }> {
  const question = "Are the tasks in this plan atomic — each independently verifiable, " +
    "small enough to complete in one turn, and with clear acceptance criteria? " +
    "Answer YES or NO."

  const result = await judge(question, planText)
  return { pass: result.pass, reason: result.output }
}

/**
 * Judge whether the overall goal has been achieved.
 */
export async function judgeGoal(goalText: string, planText: string): Promise<{ pass: boolean; reason: string }> {
  const question = goalText || "Is the goal achieved based on the progress so far? Answer YES or NO."

  const result = await judge(question, planText)
  return { pass: result.pass, reason: result.output }
}
