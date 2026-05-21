// Event bus → ACP session/update notification bridge
//
// Subscribes to Quark event bus events for a given session and translates them
// into ACP SessionUpdate notifications sent to the editor.
//
// Also tracks tool calls as plan entries so editors can show execution progress.

import { bus } from "../session/events"
import type { OutgoingMessage } from "./transport"
import type { SessionId, ToolCallStatus, PlanEntry } from "./schema"

export interface BridgeHandle {
  close(): void
}

export function bridgeSession(sessionId: SessionId, send: (msg: OutgoingMessage) => void): BridgeHandle {
  const sid = sessionId

  // ── Plan tracking ──────────────────────────────────────────────────────
  // Map of callId → plan entry index (for in-place updates)
  const planCallIndex = new Map<string, number>()
  const planEntries: PlanEntry[] = []

  function emitPlan(): void {
    if (planEntries.length === 0) return
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "plan",
        entries: planEntries,
      },
    })
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  const onTextDelta = (data: { sessionId: string; delta: string; text: string }) => {
    if (data.sessionId !== sid) return
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: data.delta },
      },
    })
  }

  const onToolStart = (data: { sessionId: string; messageId: string; tool: string; callId: string }) => {
    if (data.sessionId !== sid) return
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "tool_call",
        toolCallId: data.callId,
        title: data.tool,
        kind: mapToolKind(data.tool),
        status: "pending",
      },
    })
    // Add plan entry
    planCallIndex.set(data.callId, planEntries.length)
    planEntries.push({ content: data.tool, priority: "high", status: "in_progress" })
    emitPlan()
  }

  const onToolRunning = (data: { sessionId: string; callId: string }) => {
    if (data.sessionId !== sid) return
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "tool_call_update",
        toolCallId: data.callId,
        status: "in_progress",
      },
    })
  }

  const onToolEnd = (data: {
    sessionId: string
    tool: string
    callId: string
    status: "completed" | "error"
    output?: string
    error?: string
    diff?: string
  }) => {
    if (data.sessionId !== sid) return
    const status: ToolCallStatus = data.status === "completed" ? "completed" : "failed"
    const content: Array<Record<string, unknown>> = []
    if (data.output) {
      content.push({ type: "text", text: data.output })
    }
    if (data.diff) {
      content.push({ type: "diff", path: "", newText: data.diff, oldText: null })
    }
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "tool_call_update",
        toolCallId: data.callId,
        status,
        content: content.length > 0 ? content : undefined,
        rawOutput: data.error ? { error: data.error } : undefined,
      },
    })
    // Update plan entry
    const idx = planCallIndex.get(data.callId)
    if (idx !== undefined) {
      const entry = planEntries[idx]
      if (entry) {
        planEntries[idx] = { content: entry.content, priority: entry.priority, status: "completed" }
        emitPlan()
      }
    }
  }

  const onReasoningDelta = (data: { sessionId: string; delta: string }) => {
    if (data.sessionId !== sid) return
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: data.delta },
      },
    })
  }

  const onStepFinish = (data: { sessionId: string }) => {
    if (data.sessionId !== sid) return
  }

  bus.on("text-delta", onTextDelta)
  bus.on("tool-start", onToolStart)
  bus.on("tool-running", onToolRunning)
  bus.on("tool-end", onToolEnd)
  bus.on("reasoning-delta", onReasoningDelta)
  bus.on("step-finish", onStepFinish)

  return {
    close() {
      bus.off("text-delta", onTextDelta)
      bus.off("tool-start", onToolStart)
      bus.off("tool-running", onToolRunning)
      bus.off("tool-end", onToolEnd)
      bus.off("reasoning-delta", onReasoningDelta)
      bus.off("step-finish", onStepFinish)
    },
  }
}

function mapToolKind(tool: string): string {
  switch (tool) {
    case "read": return "read"
    case "write": return "edit"
    case "edit": return "edit"
    case "bash": return "execute"
    case "search": return "search"
    default: return "other"
  }
}
