// Tool: find_session — search sessions within a task tree

import { z } from "zod"
import { defineTool } from "./tool"
import { getSession, listAllSessions } from "../session/session"
import { getTask } from "../task/task"
import type { Session } from "../session/session"

interface SessionMatch {
  sessionId: string
  title: string | null
  summary: string | null
  parentSessionId: string | null
  taskId: string | null
  filesModified: string[] | null
  score: number
}

const DECAY_LAMBDA = 0.05 // per day — half-life ≈ 14 days

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,._\-:;!?()[\]{}'"\/\\]+/)
    .filter((t) => t.length > 0)
}

function ageInDays(timestampMs: number, nowMs: number): number {
  return (nowMs - timestampMs) / (1000 * 60 * 60 * 24)
}

function decayMultiplier(ageDays: number): number {
  return Math.exp(-DECAY_LAMBDA * ageDays)
}

function keywordScore(session: Session, queryTokens: string[]): number {
  let score = 0

  const fields = [
    session.title,
    session.summary,
    ...(session.filesModified ?? []),
  ]

  for (const field of fields) {
    if (!field) continue
    const fieldTokens = tokenize(field)
    for (const qt of queryTokens) {
      for (const ft of fieldTokens) {
        if (ft === qt) score += 1
        else if (ft.includes(qt) || qt.includes(ft)) score += 0.5
      }
    }
  }

  return score
}

function scoreSession(session: Session, queryTokens: string[], nowMs: number): number {
  const raw = keywordScore(session, queryTokens)
  if (raw === 0) return 0
  return raw * decayMultiplier(ageInDays(session.timeUpdated, nowMs))
}

export const findSessionTool = defineTool({
  id: "find_session",
  description:
    "Search sessions within the current task (or a specified task) matching a query. Returns ranked results with summary snippets. Use this to discover what work was done in other branches before reading them.",
  parameters: z.object({
    query: z.string().min(1).describe("Search query — matches against session title, summary, and files modified"),
    taskId: z.string().optional().describe("Limit search to sessions belonging to this task. Defaults to the current session's task if omitted."),
  }),
  async execute(args, ctx) {
    const allSessions = listAllSessions().filter((s) => s.kind !== "ephemeral")

    let effectiveTaskId: string | null = args.taskId ?? null

    if (!effectiveTaskId && ctx.sessionId) {
      try {
        const currentSession = getSession(ctx.sessionId)
        effectiveTaskId = currentSession.taskId
      } catch {
        // ctx.sessionId might not be a valid session — search all tasks
      }
    }

    let candidates = allSessions
    if (effectiveTaskId) {
      candidates = candidates.filter((s) => s.taskId === effectiveTaskId)
    }

    const queryTokens = tokenize(args.query)
    if (queryTokens.length === 0) {
      return {
        title: "No results",
        output: "No searchable query provided.",
        metadata: { matches: [] },
      }
    }

    const nowMs = Date.now()
    const scored: SessionMatch[] = candidates
      .map((s) => ({
        sessionId: s.id,
        title: s.title,
        summary: s.summary,
        parentSessionId: s.parentSessionId,
        taskId: s.taskId,
        filesModified: s.filesModified,
        score: scoreSession(s, queryTokens, nowMs),
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      const scope = effectiveTaskId ? `task ${effectiveTaskId.slice(0, 8)}` : "all sessions"
      return {
        title: "No matches",
        output: `No sessions found matching "${args.query}" in ${scope}.`,
        metadata: { matches: [] },
      }
    }

    const lines = scored.map((m) => {
      const id = m.sessionId.slice(0, 8)
      const task = m.taskId ? getTask(m.taskId) : null
      const taskLabel = task ? `[${task.description.slice(0, 60)}] ` : ""
      const summary = m.summary ? ` — ${m.summary.slice(0, 120)}` : ""
      return `${taskLabel}${id} (score: ${m.score.toFixed(1)})${summary}`
    })

    return {
      title: `Found ${scored.length} session(s)`,
      output: lines.join("\n"),
      metadata: { matches: scored },
    }
  },
})
