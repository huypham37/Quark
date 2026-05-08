// SessionInitializer — generate a title and link the session to a task

import { generateText, type LanguageModel } from "ai"
import { z } from "zod"
import { createTask, findTaskByDescription, updateTask } from "../task/task"
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

function linkTask(input: {
  sessionId: string
  init: InitResult
  profile: string
}): void {
  const existing = findTaskByDescription(input.init.task)
  const task = existing
    ? updateTask(existing.id, { timeUpdated: Date.now() })
    : createTask({
        title: input.init.task,
        description: input.init.task,
        profile: input.profile,
      })

  const session = getSession(input.sessionId)
  updateSession(input.sessionId, {
    ...(session.title ? {} : { title: input.init.title }),
    taskId: task.id,
  })
}

export function initializeSessionFromMessage(input: {
  sessionId: string
  message: string
  profile: string
}): void {
  linkTask({
    sessionId: input.sessionId,
    init: fallbackInit(input.message),
    profile: input.profile,
  })
}

export async function initializeSession(input: {
  sessionId: string
  message: string
  model: LanguageModel
  profile: string
}): Promise<void> {
  let init = fallbackInit(input.message)

  try {
    const result = await generateText({
      model: input.model,
      messages: [{ role: "user", content: buildInitializerPrompt(input.message) }],
      maxRetries: 1,
    })
    init = parseInitializerText(result.text) ?? init
  } catch {
    // Fallback still creates a task and title.
  }

  linkTask({
    sessionId: input.sessionId,
    init,
    profile: input.profile,
  })
}
