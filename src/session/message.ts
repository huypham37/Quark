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
  // Optional streaming content for long-running tool outputs (e.g. write).
  // Stored so the TUI can restore in-progress streaming views after reload.
  streamingContent?: string
}

export interface StepFinishData {
  reason: string
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  cost?: number
}

export interface SummaryData {
  text: string
}

export interface ImagePartData {
  mime: string
  data: string // base64
}

export interface ReasoningPartData {
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
  type: "text" | "tool" | "step-start" | "step-finish" | "summary" | "image" | "reasoning"
  data: string // JSON
}

// ---- Save operations ----

export function saveUserMessage(input: {
  sessionId: string
  text: string
  images?: { mime: string; data: string }[]
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

  // Persist image parts if any
  for (const img of input.images ?? []) {
    db.insert(part).values({
      id: generateId(),
      messageId: msgId,
      sessionId: input.sessionId,
      type: "image",
      data: JSON.stringify({ mime: img.mime, data: img.data } satisfies ImagePartData),
    }).run()
  }

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
  type: "text" | "tool" | "step-start" | "step-finish" | "summary" | "reasoning"
  data: TextPartData | ToolPartData | StepFinishData | SummaryData | ReasoningPartData | Record<string, never>
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

  // Find the latest anchor (compaction summary with compactedUntilMessageId).
  // Messages up to and including compactedUntilMessageId are replaced by the
  // anchor summary. The anchor message itself is also skipped.
  let anchorSummaryText: string | undefined
  let cutoffMessageId: string | undefined
  let anchorMessageId: string | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.providerId !== "compaction") continue
    const msgParts = partsByMsg.get(msg.id) ?? []
    const summaryPart = msgParts.find((p) => p.type === "summary")
    if (!summaryPart) continue
    const d = JSON.parse(summaryPart.data) as { text: string; compactedUntilMessageId?: string }
    if (d.text) {
      anchorSummaryText = d.text
      cutoffMessageId = d.compactedUntilMessageId
      anchorMessageId = msg.id
      break
    }
  }

  const result: ModelMessage[] = []

  // If there's an anchor, inject its summary as the first user message
  if (anchorSummaryText) {
    result.push({ role: "user", content: anchorSummaryText })
  }

  // Determine start index: skip all messages up to and including the cutoff,
  // and also skip the anchor message itself
  let startIdx = 0
  if (cutoffMessageId) {
    // Find the cutoff message and start after it
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.id === cutoffMessageId) {
        startIdx = i + 1
        break
      }
    }
  } else if (anchorMessageId) {
    // Legacy: no compactedUntilMessageId, skip up to anchor message
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.id === anchorMessageId) {
        startIdx = i + 1
        break
      }
    }
  }

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]!
    // Skip anchor messages — their content is already injected above
    if (msg.providerId === "compaction") continue
    const msgParts = partsByMsg.get(msg.id) ?? []

    if (msg.role === "user") {
      // Collect text and image parts
      const content: Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType: string }> = []
      for (const p of msgParts) {
        if (p.type === "text") {
          const d = JSON.parse(p.data) as TextPartData
          if (d.text) content.push({ type: "text", text: d.text })
        } else if (p.type === "summary") {
          const d = JSON.parse(p.data) as SummaryData
          if (d.text) content.push({ type: "text", text: d.text })
        } else if (p.type === "image") {
          const d = JSON.parse(p.data) as ImagePartData
          content.push({ type: "image", image: d.data, mimeType: d.mime })
        }
      }
      if (content.length === 1 && content[0]?.type === "text") {
        result.push({ role: "user", content: content[0].text })
      } else if (content.length > 0) {
        result.push({ role: "user", content })
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
