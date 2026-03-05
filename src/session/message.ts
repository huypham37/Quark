// Message persistence — save, load, convert to AI SDK ModelMessage format
//
// DB structure: Message has many Parts. Parts hold the content as JSON blobs.
// For LLM calls, we convert these to ModelMessage[] (the AI SDK wire format).

import { eq, asc } from "drizzle-orm"
import { generateId } from "ai"
import type { ModelMessage, AssistantModelMessage, ToolModelMessage } from "ai"
import { getDB } from "../storage/db"
import { message, part } from "./session.sql"

// ---- Types for Part data blobs ----

export interface TextPartData {
  text: string
}

export interface ToolPartData {
  tool: string
  callId: string
  status: "pending" | "running" | "completed" | "error"
  input: Record<string, unknown>
  output?: string
  error?: string
}

export interface StepFinishData {
  reason: string
  tokens?: { input?: number; output?: number }
  cost?: number
}

export interface SummaryData {
  text: string
}

// ---- DB row types ----

export interface MessageRow {
  id: string
  sessionId: string
  role: "user" | "assistant"
  modelId: string | null
  providerId: string | null
  finish: "stop" | "tool-calls" | "length" | null
  cost: number | null
  tokensIn: number | null
  tokensOut: number | null
  timeCreated: number
  timeCompleted: number | null
}

export interface PartRow {
  id: string
  messageId: string
  sessionId: string
  type: "text" | "tool" | "step-start" | "step-finish" | "summary"
  data: string // JSON
}

// ---- Save operations ----

export function saveUserMessage(input: {
  sessionId: string
  text: string
}): MessageRow {
  const db = getDB()
  const now = Date.now()
  const msgId = generateId()
  const partId = generateId()

  const msgRow: typeof message.$inferInsert = {
    id: msgId,
    sessionId: input.sessionId,
    role: "user",
    timeCreated: now,
    timeCompleted: now,
  }

  const partRow: typeof part.$inferInsert = {
    id: partId,
    messageId: msgId,
    sessionId: input.sessionId,
    type: "text",
    data: JSON.stringify({ text: input.text } satisfies TextPartData),
  }

  db.insert(message).values(msgRow).run()
  db.insert(part).values(partRow).run()

  return {
    id: msgId,
    sessionId: input.sessionId,
    role: "user",
    modelId: null,
    providerId: null,
    finish: null,
    cost: null,
    tokensIn: null,
    tokensOut: null,
    timeCreated: now,
    timeCompleted: now,
  }
}

export function createAssistantMessage(input: {
  sessionId: string
  modelId?: string
  providerId?: string
}): MessageRow {
  const db = getDB()
  const now = Date.now()
  const msgId = generateId()

  const msgRow: typeof message.$inferInsert = {
    id: msgId,
    sessionId: input.sessionId,
    role: "assistant",
    modelId: input.modelId ?? null,
    providerId: input.providerId ?? null,
    timeCreated: now,
  }

  db.insert(message).values(msgRow).run()

  return {
    id: msgId,
    sessionId: input.sessionId,
    role: "assistant",
    modelId: input.modelId ?? null,
    providerId: input.providerId ?? null,
    finish: null,
    cost: null,
    tokensIn: null,
    tokensOut: null,
    timeCreated: now,
    timeCompleted: null,
  }
}

export function addPart(input: {
  messageId: string
  sessionId: string
  type: "text" | "tool" | "step-start" | "step-finish" | "summary"
  data: TextPartData | ToolPartData | StepFinishData | SummaryData | Record<string, never>
}): string {
  const db = getDB()
  const id = generateId()

  db.insert(part)
    .values({
      id,
      messageId: input.messageId,
      sessionId: input.sessionId,
      type: input.type,
      data: JSON.stringify(input.data),
    })
    .run()

  return id
}

export function updatePart(
  id: string,
  data: TextPartData | ToolPartData | StepFinishData | SummaryData | Record<string, never>,
): void {
  const db = getDB()
  db.update(part)
    .set({ data: JSON.stringify(data) })
    .where(eq(part.id, id))
    .run()
}

export function finishMessage(
  id: string,
  finish: "stop" | "tool-calls" | "length",
  usage?: { tokensIn?: number; tokensOut?: number; cost?: number },
): void {
  const db = getDB()
  db.update(message)
    .set({
      finish,
      tokensIn: usage?.tokensIn ?? null,
      tokensOut: usage?.tokensOut ?? null,
      cost: usage?.cost ?? null,
      timeCompleted: Date.now(),
    })
    .where(eq(message.id, id))
    .run()
}

// ---- Load operations ----

export function loadMessages(sessionId: string): {
  messages: MessageRow[]
  parts: PartRow[]
} {
  const db = getDB()

  const messages = db
    .select()
    .from(message)
    .where(eq(message.sessionId, sessionId))
    .orderBy(asc(message.timeCreated))
    .all()

  const parts = db
    .select()
    .from(part)
    .where(eq(part.sessionId, sessionId))
    .all()

  return { messages, parts }
}

// ---- Convert to AI SDK ModelMessage[] ----
//
// We construct ModelMessage[] directly rather than going through UIMessage +
// convertToModelMessages. This is simpler for our minimal agent — we know
// exactly what our Part shapes look like.

export function toModelMessages(
  messages: MessageRow[],
  parts: PartRow[],
): ModelMessage[] {
  // Group parts by message ID
  const partsByMsg = new Map<string, PartRow[]>()
  for (const p of parts) {
    const list = partsByMsg.get(p.messageId) ?? []
    list.push(p)
    partsByMsg.set(p.messageId, list)
  }

  // Find the last summary message — everything before it is replaced
  // by the summary text as a single user message
  let summaryStartIdx = -1
  let summaryText: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    const msgParts = partsByMsg.get(msg.id) ?? []
    const summaryPart = msgParts.find((p) => p.type === "summary")
    if (summaryPart && msg.providerId === "compaction") {
      summaryStartIdx = i
      const d = JSON.parse(summaryPart.data) as SummaryData
      summaryText = d.text
      break
    }
  }

  const result: ModelMessage[] = []

  // If there's a summary, inject it as the first user message
  if (summaryText && summaryStartIdx >= 0) {
    result.push({ role: "user", content: summaryText })
  }

  // Start from after the summary message (or from the beginning)
  const startIdx = summaryStartIdx >= 0 ? summaryStartIdx + 1 : 0

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]!
    const msgParts = partsByMsg.get(msg.id) ?? []

    if (msg.role === "user") {
      // Collect text from all text/summary parts
      const texts: string[] = []
      for (const p of msgParts) {
        if (p.type === "text") {
          const d = JSON.parse(p.data) as TextPartData
          texts.push(d.text)
        } else if (p.type === "summary") {
          const d = JSON.parse(p.data) as SummaryData
          texts.push(d.text)
        }
      }
      if (texts.length > 0) {
        result.push({ role: "user", content: texts.join("\n") })
      }
      continue
    }

    // Assistant message — may contain text + tool calls
    // We need to emit:
    // 1. AssistantModelMessage with text + tool-call parts
    // 2. ToolModelMessage with tool results (one per completed tool)

    const assistantContent: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = []

    const toolResults: Array<{
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: { type: "text"; value: string }
    }> = []

    for (const p of msgParts) {
      if (p.type === "text") {
        const d = JSON.parse(p.data) as TextPartData
        if (d.text) {
          assistantContent.push({ type: "text", text: d.text })
        }
      } else if (p.type === "summary") {
        const d = JSON.parse(p.data) as SummaryData
        assistantContent.push({ type: "text", text: d.text })
      } else if (p.type === "tool") {
        const d = JSON.parse(p.data) as ToolPartData
        // Always add the tool call to assistant content
        assistantContent.push({
          type: "tool-call",
          toolCallId: d.callId,
          toolName: d.tool,
          input: d.input,
        })
        // Add result if completed or error
        if (d.status === "completed" || d.status === "error") {
          toolResults.push({
            type: "tool-result",
            toolCallId: d.callId,
            toolName: d.tool,
            output: {
              type: "text",
              value: d.error ? `Error: ${d.error}` : (d.output ?? ""),
            },
          })
        }
      }
      // step-start, step-finish are metadata — skip for LLM context
    }

    if (assistantContent.length > 0) {
      const msg: AssistantModelMessage = {
        role: "assistant",
        content: assistantContent,
      }
      result.push(msg)
    }

    if (toolResults.length > 0) {
      const msg: ToolModelMessage = {
        role: "tool",
        content: toolResults,
      }
      result.push(msg)
    }
  }

  return result
}
