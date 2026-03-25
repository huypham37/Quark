// prompt() entry point + loop() — the core agent loop
//
// Flow:
// 1. prompt() saves the user message, creates/resumes a session, enters loop()
// 2. loop() iterates:
//    a. Load all messages from DB → convert to ModelMessage[]
//    b. Build system prompt
//    c. Resolve tools (ToolDef → AI SDK tool objects)
//    d. Create an assistant message row
//    e. Call processStream() which streams, persists parts, returns outcome
//    f. "continue" → next iteration (tool calls need follow-up)
//    g. "stop" → break

import { tool, jsonSchema, type ToolSet, type ToolExecutionOptions } from "ai"
import { z } from "zod"
import { createSession, getSession, touchSession } from "./session"
import { saveUserMessage, createAssistantMessage, addPart, finishMessage, loadMessages, toModelMessages } from "./message"
import { buildSystem } from "./system"
import { processStream } from "./processor"
import { shouldCompact, estimateTokens } from "./compaction"
import {
  resolve as resolveCompaction,
  takePending,
  type CompactMethodContext,
} from "./compact-resolver"
import { generateSessionTitle } from "./title"
import { list as listTools, resolve as resolveTools } from "../tool/registry"
import { getModel, createCopilotProvider } from "../provider/provider"
import { loadToken } from "../provider/copilot-auth"
import { getModelLimit } from "../provider/models"
import { defaultAgent, type AgentConfig } from "../agent"
import { getModelId, loadConfig } from "../config/config"
import type { ToolDef, ToolResult } from "../tool/tool"
import {
  ask as askPermission,
  evaluate as evaluatePermission,
  type Ruleset,
  DeniedError,
  RejectedError,
  CorrectedError,
} from "../permission/permission"
import { bus } from "./events"

// ---------------------------------------------------------------------------
// Active sessions — track abort controllers so we can cancel
// ---------------------------------------------------------------------------
const active = new Map<string, AbortController>()

// ---------------------------------------------------------------------------
// prompt() — public entry point
// ---------------------------------------------------------------------------
export async function prompt(input: {
  sessionId?: string
  parts: { type: "text"; text: string }[]
  model?: { provider: string; model: string }
  agent?: AgentConfig
}) {
  const agent = input.agent ?? defaultAgent

  // Resolve or create session
  let sessionId: string
  if (input.sessionId) {
    getSession(input.sessionId) // throws if missing
    sessionId = input.sessionId
  } else {
    const sess = createSession()
    sessionId = sess.id
  }

  touchSession(sessionId)

  // Save user message (concatenate all text parts)
  const text = input.parts.map((p) => p.text).join("\n")
  saveUserMessage({ sessionId, text })
  bus.emit("user-message", { sessionId, messageId: "", text })

  // Enter the loop
  const controller = new AbortController()
  active.set(sessionId, controller)
  bus.emit("loop-start", { sessionId })
  try {
    // Generate a title in the background if session is untitled
    // Uses the small_model from config — cheap and fast
    const session = getSession(sessionId)
    if (!session.title) {
      resolveModel(input.model, "small").then((model) => {
        generateSessionTitle({ sessionId, message: text, model })
      }).catch(() => {
        // Title generation is best-effort — never fail the session
      })
    }

    await loop(sessionId, controller.signal, agent, input.model)
  } finally {
    active.delete(sessionId)
    bus.emit("loop-end", { sessionId })
  }

  return { sessionId }
}

// ---------------------------------------------------------------------------
// cancel() — abort a running session
// ---------------------------------------------------------------------------
export function cancel(sessionId: string) {
  const controller = active.get(sessionId)
  if (controller) {
    controller.abort()
    active.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// loop() — the heart of the agent
// ---------------------------------------------------------------------------
async function loop(
  sessionId: string,
  abort: AbortSignal,
  agent: AgentConfig,
  modelOpt?: { provider: string; model: string },
) {
  // Build the AI SDK model (uses main_model from config)
  const model = await resolveModel(modelOpt, "main")
  const modelId = modelOpt?.model ?? getModelId("main")
  const modelLimit = getModelLimit(modelId)

  // mutable — may change when compaction creates a new session
  let currentSessionId = sessionId

  let step = 0
  while (true) {
    if (abort.aborted) break
    step++

    // Safety: prevent runaway loops
    if (step > loadConfig().max_steps) break

    // 0. Run pending compaction (queued from previous iteration or tool call)
    const pendingReq = takePending(currentSessionId)
    if (pendingReq) {
      bus.emit("compaction-start", { sessionId: currentSessionId })
      try {
        const result = await resolveCompaction({
          trigger: pendingReq.trigger,
          ctx: pendingReq.ctx,
          methodId: pendingReq.methodId,
        })
        bus.emit("compaction-end", { sessionId: currentSessionId, result })
        if (result.type === "new-session") {
          currentSessionId = result.newSessionId
          const { messages: newMsgs, parts: newParts } = loadMessages(currentSessionId)
          const { dbToTuiMessages } = await import("../tui/state")
          const sys = buildSystem(agent)
          const newModelMsgs = toModelMessages(newMsgs, newParts)
          const sysStr = Array.isArray(sys) ? sys.join("\n") : sys
          bus.emit("session-switch", {
            sessionId: currentSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens: estimateTokens(sysStr, newModelMsgs),
          })
        }
      } catch (err) {
        bus.emit("compaction-end", { sessionId: currentSessionId, result: null })
        bus.emit("error", { sessionId: currentSessionId, error: err })
      }
    }

    // 1. Load conversation history
    const { messages, parts } = loadMessages(currentSessionId)
    const modelMessages = toModelMessages(messages, parts)

    // 2. Build system prompt
    const system = buildSystem(agent)

    // 3. Check if compaction is needed BEFORE the model call
    const cfg = loadConfig()
    if (cfg.compact.auto && shouldCompact(system, modelMessages, modelLimit, cfg.context_window, cfg.compact.threshold)) {
      bus.emit("compaction-start", { sessionId: currentSessionId })
      try {
        const compactCtx: CompactMethodContext = {
          sessionId: currentSessionId,
          messages,
          parts,
          modelMessages,
          model,
          agentPrompt: system,
          budget: modelLimit,
          persist: { createMessage: createAssistantMessage, addPart, finishMessage, saveUserMessage },
          session: { create: createSession },
        }
        const compactResult = await resolveCompaction({ trigger: "auto", ctx: compactCtx })
        bus.emit("compaction-end", { sessionId: currentSessionId, result: compactResult })

        if (compactResult.type === "new-session") {
          currentSessionId = compactResult.newSessionId
          // Load the new session's messages for the TUI
          const { messages: newMsgs, parts: newParts } = loadMessages(currentSessionId)
          const { dbToTuiMessages } = await import("../tui/state")
          const systemStr = Array.isArray(system) ? system.join("\n") : system
          const newModelMessages = toModelMessages(newMsgs, newParts)
          const estimatedTokens = estimateTokens(systemStr, newModelMessages)
          bus.emit("session-switch", {
            sessionId: currentSessionId,
            messages: dbToTuiMessages(newMsgs, newParts),
            estimatedTokens,
          })
        }

        // Re-load after compaction so the model sees the compacted context
        continue
      } catch (err) {
        bus.emit("compaction-end", { sessionId: currentSessionId, result: null })
        bus.emit("error", { sessionId: currentSessionId, error: err })
        // Continue with full context if compaction fails
      }
    }

    // 4. Create assistant message row
    const assistantMsg = createAssistantMessage({
      sessionId: currentSessionId,
      modelId: modelOpt?.model,
      providerId: modelOpt?.provider ?? "copilot",
    })
    bus.emit("assistant-message-start", { sessionId: currentSessionId, messageId: assistantMsg.id })

    // 5. Resolve tools with correct context for this iteration
    const tools = resolveToolSet(agent, currentSessionId, assistantMsg.id, abort, modelMessages)

    // 6. Stream + process
    const result = await processStream({
      model,
      system,
      messages: modelMessages,
      tools,
      abort,
      msg: assistantMsg,
      sessionId: currentSessionId,
    })

    // 7. Decide next action
    if (result === "continue") continue
    break // "stop"
  }
}

// ---------------------------------------------------------------------------
// resolveModel — get the AI SDK LanguageModel
//
// kind: "main" (default) uses main_model from config
//        "small" uses small_model (for lightweight tasks like title generation)
//
// If opt.model is explicitly provided, it always wins over config.
// ---------------------------------------------------------------------------
export async function resolveModel(
  opt?: { provider: string; model: string },
  kind: "main" | "small" = "main",
) {
  // Validate that a token exists at startup
  const initial = loadToken()
  if (!initial) {
    throw new Error(
      "No Copilot token found. Run the login flow first (scripts/copilot-login.ts).",
    )
  }

  // Pass a callback that re-reads token on each request (avoids stale closures)
  const provider = createCopilotProvider({
    getToken: async () => {
      const token = loadToken()
      if (!token) throw new Error("Copilot token expired or removed.")
      return token
    },
  })

  // Explicit override wins, otherwise use config
  const modelId = opt?.model ?? getModelId(kind)
  return getModel(provider, modelId)
}

// ---------------------------------------------------------------------------
// resolveToolSet — convert our ToolDef[] to AI SDK ToolSet
// ---------------------------------------------------------------------------
function resolveToolSet(
  agent: AgentConfig,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
  messages: any[],
): ToolSet {
  const defs = resolveTools(agent.tools)
  const result: ToolSet = {}

  for (const def of defs) {
    result[def.id] = toAITool(def, sessionId, messageId, abort, messages)
  }

  return result
}

// ---------------------------------------------------------------------------
// toAITool — convert a single ToolDef to an AI SDK tool()
// ---------------------------------------------------------------------------
function toAITool(
  def: ToolDef,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
  messages: any[],
) {
  const schema = z.toJSONSchema(def.parameters)

  return tool({
    description: def.description,
    inputSchema: jsonSchema(schema as any),
    async execute(args: any, options: ToolExecutionOptions) {
      const ctx = {
        sessionId,
        messageId,
        abort: options.abortSignal ?? abort,
        messages,
        async ask(permission: string, pattern: string) {
          await askPermission({
            sessionId,
            permission,
            pattern,
            ruleset: [], // TODO: load project/config rules when config system exists
          })
        },
      }
      return def.execute(args, ctx)
    },
    toModelOutput(result: any) {
      return {
        type: "text" as const,
        value: result.output as string,
      }
    },
  })
}
