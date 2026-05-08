// Tool: read_session — read a session's summary and lineage context

import { z } from "zod"
import { defineTool } from "./tool"
import { getSession } from "../session/session"
import { buildLineageContext, findSessionByPrefix } from "../session/branch"

export const readSessionTool = defineTool({
  id: "read_session",
  description:
    "Read a session's summary and full lineage context. Use this to understand what happened in another branch without switching to it. Returns the task description, parent summaries, and the target session's own summary.",
  parameters: z.object({
    sessionId: z.string().min(1).describe("Session ID (or unique prefix) to read"),
  }),
  async execute(args, _ctx) {
    const session = findSessionByPrefix(args.sessionId) ?? getSession(args.sessionId)

    const lineage = buildLineageContext(session.id)

    if (!lineage) {
      return {
        title: `Session ${session.id.slice(0, 8)}`,
        output: `Session ${session.id.slice(0, 8)} has no summary or task context yet.`,
        metadata: { sessionId: session.id, hasSummary: false },
      }
    }

    return {
      title: `Session ${session.id.slice(0, 8)}`,
      output: lineage,
      metadata: { sessionId: session.id, hasSummary: session.summary != null },
    }
  },
})
