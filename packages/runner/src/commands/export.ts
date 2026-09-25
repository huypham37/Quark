import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getSession } from "../session/session"
import { loadMessages, type MessageRow, type PartRow } from "../session/message"

export interface ExportResult {
  filePath: string
  messageCount: number
}

export function exportSessionToMarkdown(
  sessionId: string,
  opts?: { cwd?: string },
): ExportResult {
  const session = getSession(sessionId)
  const { messages, parts } = loadMessages(sessionId)
  const entries = buildMarkdownEntries(messages, parts)

  const exportDir = join(opts?.cwd ?? process.cwd(), ".quark", "export")
  mkdirSync(exportDir, { recursive: true })

  const filename = `${sanitizeFilename(session.title ?? session.id)}.md`
  const filePath = join(exportDir, filename)
  writeFileSync(filePath, renderMarkdown(entries), "utf-8")

  return { filePath, messageCount: entries.length }
}

function buildMarkdownEntries(
  messages: MessageRow[],
  parts: PartRow[],
): { role: "user" | "assistant"; text: string }[] {
  const partsByMessage = new Map<string, PartRow[]>()
  for (const part of parts) {
    const list = partsByMessage.get(part.messageId) ?? []
    list.push(part)
    partsByMessage.set(part.messageId, list)
  }

  const entries: { role: "user" | "assistant"; text: string }[] = []
  for (const message of messages) {
    // Skip aborted messages
    if (message.finish === "aborted") continue
    const text = (partsByMessage.get(message.id) ?? [])
      .filter((part) => part.type === "text")
      .map((part) => {
        try {
          const data = JSON.parse(part.data) as { text?: string }
          return data.text?.trimEnd() ?? ""
        } catch {
          return ""
        }
      })
      .filter(Boolean)
      .join("\n\n")

    if (text) entries.push({ role: message.role, text })
  }

  return entries
}

function renderMarkdown(entries: { role: "user" | "assistant"; text: string }[]): string {
  if (entries.length === 0) return ""

  return entries
    .map((entry) => `## ${entry.role === "user" ? "User" : "Assistant"}\n\n${entry.text}`)
    .join("\n\n") + "\n"
}

function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?%*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")

  return sanitized || "conversation"
}
