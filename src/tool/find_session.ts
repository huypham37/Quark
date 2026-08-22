// Tool: find_session — search persisted sessions

import { z } from "zod"
import { defineTool } from "./tool"
import { listAllSessions, type Session } from "../session/session"

interface SessionMatch {
  sessionId: string
  title: string | null
  summary: string | null
  parentSessionId: string | null
  filesModified: string[] | null
  score: number
}

const DECAY_LAMBDA = 0.05 // per day — half-life ≈ 14 days

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,._\-:;!?()[\]{}'"\/\\]+/)
    .filter((token) => token.length > 0)
}

function ageInDays(timestampMs: number, nowMs: number): number {
  return (nowMs - timestampMs) / (1000 * 60 * 60 * 24)
}

function keywordScore(session: Session, queryTokens: string[]): number {
  let score = 0
  const fields = [session.title, session.summary, ...(session.filesModified ?? [])]

  for (const field of fields) {
    if (!field) continue
    const fieldTokens = tokenize(field)
    for (const queryToken of queryTokens) {
      for (const fieldToken of fieldTokens) {
        if (fieldToken === queryToken) score += 1
        else if (fieldToken.includes(queryToken) || queryToken.includes(fieldToken)) score += 0.5
      }
    }
  }
  return score
}

function scoreSession(session: Session, queryTokens: string[], nowMs: number): number {
  const raw = keywordScore(session, queryTokens)
  if (raw === 0) return 0
  return raw * Math.exp(-DECAY_LAMBDA * ageInDays(session.timeUpdated, nowMs))
}

export const findSessionTool = defineTool({
  id: "find_session",
  description:
    "Search persisted sessions matching a query. Returns ranked results with summary snippets. Use this to discover prior work before reading a session.",
  parameters: z.object({
    query: z.string().min(1).describe("Search query — matches against session title, summary, and files modified"),
  }),
  async execute(args) {
    const queryTokens = tokenize(args.query)
    if (queryTokens.length === 0) {
      return {
        title: "No results",
        output: "No searchable query provided.",
        metadata: { matches: [] },
      }
    }

    const nowMs = Date.now()
    const matches: SessionMatch[] = listAllSessions()
      .filter((session) => session.kind !== "ephemeral")
      .map((session) => ({
        sessionId: session.id,
        title: session.title,
        summary: session.summary,
        parentSessionId: session.parentSessionId,
        filesModified: session.filesModified,
        score: scoreSession(session, queryTokens, nowMs),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)

    if (matches.length === 0) {
      return {
        title: "No matches",
        output: `No sessions found matching "${args.query}".`,
        metadata: { matches: [] },
      }
    }

    const lines = matches.map((match) => {
      const summary = match.summary ? ` — ${match.summary.slice(0, 120)}` : ""
      return `${match.sessionId.slice(0, 8)} (score: ${match.score.toFixed(1)})${summary}`
    })

    return {
      title: `Found ${matches.length} session(s)`,
      output: lines.join("\n"),
      metadata: { matches },
    }
  },
})
