// Permission system — evaluate rules before tool execution
//
// Design (inspired by Opencode's PermissionNext):
// - Rules match tool name + argument pattern via wildcard/glob matching
// - Last matching rule wins (later rules override earlier ones)
// - Default action is "ask" when no rules match
// - "ask" pauses tool execution until the TUI resolves via respond()
// - "deny" throws DeniedError immediately
// - "allow" proceeds silently
//
// Wildcard matching: * matches any sequence, ? matches single char.
// Special case: trailing " *" is optional (e.g. "ls *" matches "ls" and "ls -la")

import os from "os"
import { bus } from "../session/events"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Action = "allow" | "deny" | "ask"

export interface Rule {
  permission: string // tool id or category (supports wildcards)
  pattern: string // glob pattern for the argument (e.g. file path)
  action: Action
}

export type Ruleset = Rule[]

export type Reply = "once" | "always" | "reject"

export interface PendingRequest {
  id: string
  sessionId: string
  permission: string
  pattern: string
  metadata: Record<string, any>
  resolve: () => void
  reject: (e: Error) => void
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** User rejected without feedback — halts tool execution */
export class RejectedError extends Error {
  constructor() {
    super(
      "The user rejected permission to use this specific tool call. You may try again with different parameters.",
    )
  }
}

/** User rejected with feedback — continues with guidance */
export class CorrectedError extends Error {
  constructor(message: string) {
    super(
      `The user rejected permission to use this specific tool call with the following feedback: ${message}`,
    )
  }
}

/** Auto-rejected by a config/project rule — halts tool execution */
export class DeniedError extends Error {
  constructor(public readonly rules: Ruleset) {
    super(
      `A permission rule prevents this tool call. Relevant rules: ${JSON.stringify(rules)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Wildcard matching
// ---------------------------------------------------------------------------

/**
 * Match a string against a wildcard pattern.
 * Supports `*` (any sequence) and `?` (single char).
 * Normalizes path separators to `/`.
 * Trailing " *" (space+wildcard) is optional — "ls *" matches "ls".
 */
export function wildcardMatch(str: string, pattern: string): boolean {
  if (!str && !pattern) return true
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")

  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars
    .replace(/\*/g, ".*") // * → .*
    .replace(/\?/g, ".") // ? → .

  // "ls *" should match both "ls" and "ls -la"
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  return new RegExp("^" + escaped + "$", "s").test(str)
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Expand ~ and $HOME in rule patterns to the actual home directory.
 */
export function expandPath(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

/**
 * Evaluate permission rules for a given tool + pattern.
 * Last matching rule wins (later rules override). Default: "ask".
 */
export function evaluate(
  tool: string,
  pattern: string,
  ...rulesets: Ruleset[]
): Rule {
  const merged = rulesets.flat()
  const match = merged.findLast(
    (rule) =>
      wildcardMatch(tool, rule.permission) &&
      wildcardMatch(pattern, expandPath(rule.pattern)),
  )
  return match ?? { action: "ask", permission: tool, pattern: "*" }
}

/**
 * Returns a Set of tool ids that are disabled by deny rules with pattern "*".
 * Useful for the TUI to grey out tools that can never run.
 */
export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  const EDIT_TOOLS = ["edit", "write", "patch"]
  for (const t of tools) {
    const permission = EDIT_TOOLS.includes(t) ? "edit" : t
    const rule = ruleset.findLast((r) => wildcardMatch(permission, r.permission))
    if (rule && rule.pattern === "*" && rule.action === "deny") {
      result.add(t)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Permission state (per-session in-memory)
// ---------------------------------------------------------------------------

const sessionApproved = new Map<string, Ruleset>()
const pending = new Map<string, PendingRequest>()
let nextId = 0

function genId(): string {
  return `perm_${++nextId}`
}

/**
 * List all pending permission requests.
 */
export function listPending(): PendingRequest[] {
  return [...pending.values()]
}

/**
 * List pending requests for a specific session.
 */
export function listPendingForSession(sessionId: string): PendingRequest[] {
  return [...pending.values()].filter((r) => r.sessionId === sessionId)
}

/**
 * Ask for permission before executing a tool.
 *
 * - Evaluates rules (including any per-session "always" approvals)
 * - "allow" → returns immediately
 * - "deny" → throws DeniedError
 * - "ask" → returns a Promise that resolves when respond() is called
 *
 * The TUI should subscribe to pending requests and call respond().
 */
export async function ask(input: {
  sessionId: string
  permission: string
  pattern: string
  ruleset: Ruleset
  metadata?: Record<string, any>
}): Promise<void> {
  const approved = sessionApproved.get(input.sessionId) ?? []
  const rule = evaluate(
    input.permission,
    input.pattern,
    input.ruleset,
    approved,
  )

  if (rule.action === "allow") return
  if (rule.action === "deny") {
    const relevant = input.ruleset.filter((r) =>
      wildcardMatch(input.permission, r.permission),
    )
    throw new DeniedError(relevant)
  }

  // "ask" — enqueue a pending request and wait for the TUI to respond
  const id = genId()
  return new Promise<void>((resolve, reject) => {
    pending.set(id, {
      id,
      sessionId: input.sessionId,
      permission: input.permission,
      pattern: input.pattern,
      metadata: input.metadata ?? {},
      resolve,
      reject,
    })
    // Notify the TUI so it can show the permission prompt
    bus.emit("permission-request", {
      sessionId: input.sessionId,
      requestId: id,
      tool: input.permission,
      input: { pattern: input.pattern, ...input.metadata },
    })
  })
}

/**
 * Respond to a pending permission request.
 *
 * - "once" → allow this call only
 * - "always" → allow this permission+pattern for the rest of the session
 * - "reject" → reject with optional feedback message
 */
export function respond(input: {
  requestId: string
  reply: Reply
  message?: string
}): void {
  const req = pending.get(input.requestId)
  if (!req) return
  pending.delete(input.requestId)

  if (input.reply === "reject") {
    if (input.message) {
      req.reject(new CorrectedError(input.message))
    } else {
      req.reject(new RejectedError())
    }
    // Reject all other pending requests for this session
    for (const [id, other] of pending) {
      if (other.sessionId === req.sessionId) {
        pending.delete(id)
        other.reject(new RejectedError())
      }
    }
    return
  }

  if (input.reply === "once") {
    req.resolve()
    return
  }

  if (input.reply === "always") {
    // Add an allow rule for this session
    const approved = sessionApproved.get(req.sessionId) ?? []
    approved.push({
      permission: req.permission,
      pattern: req.pattern,
      action: "allow",
    })
    sessionApproved.set(req.sessionId, approved)

    req.resolve()

    // Auto-resolve any other pending requests for this session that are now covered
    for (const [id, other] of pending) {
      if (other.sessionId !== req.sessionId) continue
      const rule = evaluate(
        other.permission,
        other.pattern,
        approved,
      )
      if (rule.action === "allow") {
        pending.delete(id)
        other.resolve()
      }
    }
    return
  }
}

/**
 * Clear all permission state for a session (call on session end).
 */
export function clearSession(sessionId: string): void {
  sessionApproved.delete(sessionId)
  for (const [id, req] of pending) {
    if (req.sessionId === sessionId) {
      pending.delete(id)
      req.reject(new RejectedError())
    }
  }
}

/**
 * Reset all permission state (for testing).
 */
export function _reset(): void {
  sessionApproved.clear()
  pending.clear()
  nextId = 0
}
