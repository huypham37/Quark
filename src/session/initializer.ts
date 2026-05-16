// SessionInitializer — generate a title and link the session to a task
//
// Invariants:
//   - taskId is set exactly once, synchronously, on first user message
//     (via initializeSessionFromMessage). It is never rewritten afterwards.
//   - upgradeSessionTitle only refines the human-readable title; it must
//     never touch taskId.

import { generateText, type LanguageModel } from "ai"
import { z } from "zod"
import { createTask, updateTask } from "../task/task"
import { getSession, updateSession } from "./session"

export const InitSchema = z.object({
  title: z.string().min(1).max(80),
  task: z.string().min(1).max(200),
})

export type InitResult = z.infer<typeof InitSchema>

export function buildInitializerPrompt(message: string): string {
  const snippet = message.slice(0, 500)
  return [
    "Analyze the user's first message. Return ONLY valid JSON:",
    "",
    "{",
    '  "title": "2-5 word noun phrase describing the topic area",',
    '  "task": "One-sentence description of the development task. If the user is just chatting, testing, or asking a general question, set this to the same value as title."',
    "}",
    "",
    'Example: "Hello" -> {"title":"Greeting","task":"Greeting"}',
    'Example: "Add JWT refresh token rotation to the auth middleware" -> {"title":"Auth Token Rotation","task":"Add JWT refresh token rotation support to the authentication middleware"}',
    "",
    "User: " + snippet,
  ].join("\n")
}

export function parseInitializerText(text: string): InitResult | null {
  try {
    const parsed = JSON.parse(text)
    const result = InitSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function fallbackInit(message: string): InitResult {
  const firstLine = message.trim().split(/\r?\n/, 1)[0]?.trim() || "Untitled Task"
  const title = firstLine.slice(0, 80)
  const task = firstLine.slice(0, 200)
  return { title, task }
}

/**
 * Synchronously create a task from the first user message and link the
 * session to it. Idempotent — does nothing if the session already has a
 * taskId. This is the only function that assigns taskId.
 */
export function initializeSessionFromMessage(input: {
  sessionId: string
  message: string
  profile: string
}): void {
  const session = getSession(input.sessionId)
  if (session.taskId) return

  const { title, task: description } = fallbackInit(input.message)
  const task = createTask({
    title: description,
    description,
    profile: input.profile,
  })

  updateSession(input.sessionId, {
    ...(session.title ? {} : { title }),
    taskId: task.id,
  })
}

/**
 * Asynchronously refine the session title (and its task title/description)
 * using the LLM. Never touches taskId — that invariant is enforced here.
 * Requires initializeSessionFromMessage to have run first.
 */
export async function upgradeSessionTitle(input: {
  sessionId: string
  message: string
  model: LanguageModel
}): Promise<void> {
  const session = getSession(input.sessionId)
  if (!session.taskId) return

  try {
    const result = await generateText({
      model: input.model,
      messages: [{ role: "user", content: buildInitializerPrompt(input.message) }],
      maxRetries: 1,
    })
    const init = parseInitializerText(result.text)
    if (!init) return

    updateSession(input.sessionId, { title: init.title })
    updateTask(session.taskId, {
      title: init.task,
      description: init.task,
    })
  } catch {
    // Keep the fallback title — best-effort upgrade only.
  }
}
