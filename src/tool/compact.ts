// Tool: compact — LLM can request context compaction

import { z } from "zod"
import { defineTool } from "./tool"
import { resolve as resolveCompaction } from "../session/compact-resolver"
import { loadMessages, toModelMessages, createAssistantMessage, addPart, finishMessage, saveUserMessage } from "../session/message"
import { createSession } from "../session/session"
import { estimateTokens } from "../session/compaction"
import { bus } from "../session/events"
import { resolveModel } from "../session/prompt"
import { dbToTuiMessages } from "../tui/state"

export const compactTool = defineTool({
  id: "compact",
  description:
    "Compact the conversation context by summarizing older messages. " +
    "Use when you notice the context is getting large or you're told context is running low.",
  parameters: z.object({}),
  async execute(_args, ctx) {
    const { sessionId, messages: modelMessages } = ctx

    const { messages, parts } = loadMessages(sessionId)
    const model = await resolveModel()

    bus.emit("compaction-start", { sessionId })

    try {
      const result = await resolveCompaction({
        trigger: "tool",
        ctx: {
          sessionId,
          messages,
          parts,
          modelMessages,
          model,
          agentPrompt: "",
          budget: null,
          persist: { createMessage: createAssistantMessage, addPart, finishMessage, saveUserMessage },
          session: { create: createSession },
        },
      })

      bus.emit("compaction-end", { sessionId, result })

      if (result.type === "new-session") {
        if (result.newSessionId !== sessionId) {
          // Notify the TUI to switch to the new session
          const { messages: newMsgs, parts: newParts } = loadMessages(result.newSessionId)
          const newModelMessages = toModelMessages(newMsgs, newParts)
          // system is not available in the tool context; use empty string (close enough)
          const estimatedTokens = estimateTokens("", newModelMessages)
          bus.emit("session-switch", {
            sessionId: result.newSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens,
          })
        }
        return {
          title: "Context compacted",
          output: `Compacted ${result.evictedCount} messages into summary.`,
          metadata: { evictedCount: result.evictedCount, newSessionId: result.newSessionId },
        }
      }

      if (result.type === "handoff") {
        return {
          title: "Compaction handoff",
          output: `Compaction deferred: ${result.reason}`,
          metadata: { reason: result.reason },
        }
      }

      return {
        title: "Compacted",
        output: "Compaction complete.",
        metadata: {},
      }
    } catch (err) {
      bus.emit("compaction-end", { sessionId, result: null })
      throw err
    }
  },
})
