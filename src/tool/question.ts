// Question tool — agent asks the user interactive questions
//
// Similar to the permission system: execute() emits a bus event and blocks
// until the TUI resolves via respondQuestion(). The agent loop pauses while
// waiting for user input.
//
// Adapted from OpenCode's question tool contract.

import { z } from "zod"
import { generateId } from "ai"
import { defineTool, type ToolContext, type ToolResult } from "./tool"
import { bus } from "../session/events"

// ---------------------------------------------------------------------------
// Pending question requests — keyed by requestId
// ---------------------------------------------------------------------------

interface PendingQuestion {
  resolve: (answers: string[][]) => void
  reject: (error: Error) => void
}

const pending = new Map<string, PendingQuestion>()

// ---------------------------------------------------------------------------
// respondQuestion — called by the TUI to resolve a pending question
// ---------------------------------------------------------------------------

export interface QuestionResponse {
  requestId: string
  answers?: string[][]
  rejected?: boolean
}

/**
 * Resolve a pending question request.
 *
 * Called by the TUI when the user answers or dismisses a question prompt.
 * If `rejected` is true, the tool returns a "dismissed" message to the LLM.
 * Otherwise, `answers` contains the user's selections (one string[] per question).
 */
export function respondQuestion(response: QuestionResponse): void {
  const entry = pending.get(response.requestId)
  if (!entry) return

  pending.delete(response.requestId)

  if (response.rejected) {
    entry.resolve([]) // Resolve with empty answers — tool handles the messaging
  } else {
    entry.resolve(response.answers ?? [])
  }
}

// ---------------------------------------------------------------------------
// Question tool definition
// ---------------------------------------------------------------------------

const QuestionOption = z.object({
  label: z.string().describe("Display text (1-5 words, concise)"),
  description: z.string().describe("Explanation of choice"),
})

const QuestionInfo = z.object({
  question: z.string().describe("Complete question"),
  header: z.string().describe("Very short label (max 30 chars)"),
  options: z.array(QuestionOption).describe("Available choices"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
  custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
})

const parameters = z.object({
  questions: z.array(QuestionInfo.omit({ custom: true })).describe("Questions to ask"),
})

export const questionTool = defineTool({
  id: "question",
  description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
  parameters,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const requestId = generateId()

    // Create a deferred promise
    const answersPromise = new Promise<string[][]>((resolve, reject) => {
      pending.set(requestId, { resolve, reject })

      // Abort listener — clean up if session is cancelled
      const onAbort = () => {
        pending.delete(requestId)
        resolve([]) // Resolve with empty to avoid hanging
      }
      ctx.abort.addEventListener("abort", onAbort, { once: true })
    })

    // Emit the question request event for the TUI
    bus.emit("question-request", {
      sessionId: ctx.sessionId,
      requestId,
      questions: args.questions,
    })

    // Block until user responds
    const answers = await answersPromise

    // Check if aborted
    if (ctx.abort.aborted) {
      return {
        title: "Question aborted",
        output: "The question was aborted by the user.",
        metadata: { answers: [] },
      }
    }

    // Check if dismissed (empty answers from rejection)
    if (answers.length === 0) {
      return {
        title: "Question dismissed",
        output: "The user dismissed this question. Continue without the answer or try a different approach.",
        metadata: { answers: [] },
      }
    }

    // Format answers for the LLM
    const formatted = args.questions
      .map((q, i) => {
        const answer = answers[i]
        return `"${q.question}"="${answer?.length ? answer.join(", ") : "Unanswered"}"`
      })
      .join(", ")

    const count = args.questions.length
    return {
      title: `Asked ${count} question${count > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: { answers },
    }
  },
})
