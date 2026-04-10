// Compact resolver — unified entry point for all compaction triggers
//
// Three triggers can request compaction:
//   - auto:    loop detects context threshold exceeded
//   - command: user runs /compact in TUI
//   - tool:    LLM calls the compact tool
//
// The resolver:
//   1. Resolves the configured compaction method
//   2. Prevents concurrent compaction on the same session (deduplication)
//   3. Queues requests when the loop is active (pending state)
//   4. Calls method.execute() with the right context

import type { LanguageModel, ModelMessage } from "ai"
import type { MessageRow, PartRow } from "./message"
import type { Session } from "./session"

// ---------------------------------------------------------------------------
// CompactMethodDef — mirrors ToolDef pattern: { id, description, parameters, execute }
// ---------------------------------------------------------------------------

export interface CompactMethodDef {
  id: string
  description: string
  parameters: Record<string, CompactParamDef>
  execute(ctx: CompactMethodContext): Promise<CompactResult>
}

export interface CompactParamDef {
  type: "number" | "string"
  description: string
  required?: boolean
  default?: unknown
}

// ---------------------------------------------------------------------------
// CompactMethodContext — everything a method needs to do its job
// ---------------------------------------------------------------------------

export interface CompactMethodContext {
  sessionId: string
  messages: MessageRow[]
  parts: PartRow[]
  modelMessages: ModelMessage[]
  model: LanguageModel
  agentPrompt: string | string[]
  budget: { context: number; input?: number; output: number } | null
  persist: {
    createMessage: typeof import("./message").createAssistantMessage
    addPart: typeof import("./message").addPart
    finishMessage: typeof import("./message").finishMessage
    saveUserMessage: typeof import("./message").saveUserMessage
  }
  session: {
    /** Create a brand-new empty session and return it */
    create: typeof import("./session").createSession
  }
  /** Extra context strings injected by plugins via session.compacting hook */
  extraContext?: string[]
}

// ---------------------------------------------------------------------------
// CompactResult — what a method returns
// ---------------------------------------------------------------------------

export type CompactResult =
  | { type: "compacted"; summary: string; evictedCount: number }
  | { type: "new-session"; newSessionId: string; summary: string; evictedCount: number }
  | { type: "handoff"; reason: string }

export type CompactTrigger = "auto" | "command" | "tool"

// ---------------------------------------------------------------------------
// Method registry — simple map, default method set externally
// ---------------------------------------------------------------------------

const methods = new Map<string, CompactMethodDef>()
let defaultMethodId: string | null = null

export function registerMethod(method: CompactMethodDef): void {
  methods.set(method.id, method)
}

export function setDefaultMethod(id: string): void {
  if (!methods.has(id)) {
    throw new Error(`Compact method not found: ${id}`)
  }
  defaultMethodId = id
}

export function getMethod(id: string): CompactMethodDef | undefined {
  return methods.get(id)
}

// ---------------------------------------------------------------------------
// Deduplication — prevent concurrent compaction on the same session
// ---------------------------------------------------------------------------

const running = new Map<string, Promise<CompactResult>>()

// ---------------------------------------------------------------------------
// Pending state — queue a request when loop is active
// ---------------------------------------------------------------------------

export interface PendingCompaction {
  trigger: CompactTrigger
  ctx: CompactMethodContext
  methodId?: string
}

const pending = new Map<string, PendingCompaction>()

export function setPending(sessionId: string, req: PendingCompaction): void {
  pending.set(sessionId, req)
}

export function takePending(sessionId: string): PendingCompaction | undefined {
  const req = pending.get(sessionId)
  if (req) pending.delete(sessionId)
  return req
}

export function hasPending(sessionId: string): boolean {
  return pending.has(sessionId)
}

// ---------------------------------------------------------------------------
// resolve() — the main entry point
// ---------------------------------------------------------------------------

export async function resolve(input: {
  trigger: CompactTrigger
  ctx: CompactMethodContext
  methodId?: string
}): Promise<CompactResult> {
  const { trigger, ctx, methodId } = input
  const sid = ctx.sessionId

  // Deduplication: if already running for this session, return the existing promise
  const existing = running.get(sid)
  if (existing) return existing

  // Resolve method
  const id = methodId ?? defaultMethodId
  console.log("[compact-resolver] trigger:", trigger, "method:", id, "defaultMethodId:", defaultMethodId, "registered methods:", [...methods.keys()])
  if (!id) {
    throw new Error("No compaction method configured. Register a method and call setDefaultMethod().")
  }

  const method = methods.get(id)
  if (!method) {
    throw new Error(`Unknown compaction method: "${id}". Available: ${[...methods.keys()].join(", ") || "none"}`)
  }

  // Run with deduplication guard
  console.log("[compact-resolver] executing method:", method.id)
  const promise = method.execute(ctx).then((result) => {
    console.log("[compact-resolver] method returned:", JSON.stringify(result))
    return result
  }).catch((err) => {
    console.error("[compact-resolver] method execute FAILED:", err instanceof Error ? err.stack : String(err))
    throw err
  }).finally(() => {
    running.delete(sid)
  })

  running.set(sid, promise)
  return promise
}

// ---------------------------------------------------------------------------
// isRunning — check if compaction is in progress for a session
// ---------------------------------------------------------------------------

export function isRunning(sessionId: string): boolean {
  return running.has(sessionId)
}

// ---------------------------------------------------------------------------
// Reset — for testing
// ---------------------------------------------------------------------------

export function _reset(): void {
  methods.clear()
  defaultMethodId = null
  running.clear()
  pending.clear()
}
