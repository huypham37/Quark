import type { AgentConfig } from "../agent"
import { dbToConversationMessages } from "../shared/conversation-view"
import { bus } from "./events"
import { estimateTokens } from "./context"
import { loadMessages, toModelMessages } from "./message"
import { buildSystem } from "./system"

export function emitSessionSwitch(sessionId: string, agent: AgentConfig): void {
  const { messages, parts } = loadMessages(sessionId)
  const system = buildSystem(agent)
  const modelMessages = toModelMessages(messages, parts)
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  bus.emit("session-switch", {
    sessionId,
    messages: dbToConversationMessages(messages, parts),
    estimatedTokens: estimateTokens(systemStr, modelMessages),
  })
}
