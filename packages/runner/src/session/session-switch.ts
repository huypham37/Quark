import type { AgentDefinition } from "../agent"
import { dbToConversationMessages } from "../shared/conversation-view"
import { bus, TypedBus } from "./events"
import { estimateTokens } from "./context"
import { loadMessages, toModelMessages } from "./message"
import { buildSystem, type AmbientInstructions } from "./system"

export function emitSessionSwitch(
  sessionId: string,
  agent: AgentDefinition,
  transition:
    | { kind: "replace" }
    | { kind: "branch"; goal: string },
  eventBus: TypedBus = bus,
  /** Same ambient contract as buildSystem: omit / `null` for none. */
  ambient?: AmbientInstructions | null,
  /** Absolute workspace root for the same environment block buildSystem emits. */
  workspace?: string,
): void {
  const { messages, parts } = loadMessages(sessionId)
  const system = buildSystem(agent, ambient, workspace)
  const modelMessages = toModelMessages(messages, parts)
  const systemStr = Array.isArray(system) ? system.join("\n") : system
  const conversationMessages = dbToConversationMessages(messages, parts)

  if (transition.kind === "branch") {
    eventBus.emit("session-switch", {
      kind: "branch",
      sessionId,
      messages: conversationMessages,
      estimatedTokens: estimateTokens(systemStr, modelMessages),
      divider: { id: `branch:${sessionId}`, goal: transition.goal },
    })
  } else {
    eventBus.emit("session-switch", {
      kind: "replace",
      sessionId,
      messages: conversationMessages,
      estimatedTokens: estimateTokens(systemStr, modelMessages),
    })
  }
}
