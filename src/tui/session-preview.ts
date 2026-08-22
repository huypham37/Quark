import type { TuiMessage } from "./state"

export interface SessionPreview {
  user: string | null
  assistant: string | null
}

export function buildSessionPreview(messages: TuiMessage[]): SessionPreview {
  return {
    user: lastText(messages, "user"),
    assistant: lastText(messages, "assistant"),
  }
}

function lastText(messages: TuiMessage[], role: TuiMessage["role"]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role !== role) continue
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.type === "text" ? part.text : "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
  }
  return null
}
