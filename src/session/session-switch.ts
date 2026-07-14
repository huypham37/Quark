import type { AgentConfig } from "../agent"
import { dbToConversationMessages } from "../shared/conversation-view"
import { bus } from "./events"
import { estimateTokens } from "./context"
import { loadMessages, toModelMessages } from "./message"
import { buildSystem } from "./system"

export function emitSessionSwitch(
  sessionId: string,
  agent: AgentConfig,
  transition:
    | { kind: "replace" }
    | { kind: "branch"; goal: string },
): void {
  const { messages, parts } = loadMessages(sessionId)
  const system = buildSystem(agent)
  const modelMessages = toModelMessages(messages, parts)
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  const conversationMessages = dbToConversationMessages(messages, parts)

  if (transition.kind === "branch") {
    bus.emit("session-switch", {
      kind: "branch",
      sessionId,
      messages: conversationMessages,
      estimatedTokens: estimateTokens(systemStr, modelMessages),
      divider: { id: `branch:${sessionId}`, goal: transition.goal },
    })
  } else {
    bus.emit("session-switch", {
      kind: "replace",
      sessionId,
      messages: conversationMessages,
      estimatedTokens: estimateTokens(systemStr, modelMessages),
    })
  }
}
