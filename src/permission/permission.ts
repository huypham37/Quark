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

/** Permission action: allow silently, deny immediately, or pause and ask the user. */
export type Action = "allow" | "deny" | "ask"

/**
 * A single permission rule.
 * Rules are evaluated in order; the **last matching rule wins**.
 */
export interface Rule {
  /** Tool ID or category to match (supports `*` and `?` wildcards) */
  permission: string
  /** Glob pattern for the argument (e.g. a file path). Use `"*"` to match anything. */
  pattern: string
  /** The action to take when this rule matches */
  action: Action
}

/**
 * An ordered list of {@link Rule}s.
 * Later rules override earlier ones (last-matching-rule-wins).
 */
export type Ruleset = Rule[]

/**
 * The response to a pending permission request.
 * - `"once"` — allow this single tool call only
 * - `"always"` — add a session-scope allow rule covering this permission+pattern
 * - `"reject"` — deny with optional feedback message
 */
export type Reply = "once" | "always" | "reject"

/**
 * An in-flight permission request waiting for a user response.
 * Emitted as a `permission-request` bus event so the TUI can display a prompt.
 */
export interface PendingRequest {
  /** Unique request ID */
  id: string
  /** Session this request belongs to */
  sessionId: string
  /** Permission category being requested (typically the tool ID) */
  permission: string
  /** The specific resource pattern (e.g. file path) */
  pattern: string
  /** Additional metadata for the TUI to display */
  metadata: Record<string, any>
  resolve: () => void
  reject: (e: Error) => void
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the user rejects a permission request without feedback — halts tool execution. */
export class RejectedError extends Error {
  constructor() {
    super(
      "The user rejected permission to use this specific tool call. You may try again with different parameters.",
    )
  }
}

/** Thrown when the user rejects a permission request with feedback text — the message is forwarded to the LLM. */
export class CorrectedError extends Error {
  constructor(message: string) {
    super(
      `The user rejected permission to use this specific tool call with the following feedback: ${message}`,
    )
  }
}

/** Thrown when a hard `deny` rule matches — halts tool execution immediately. */
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
 *
 * - `*` matches any sequence of characters
 * - `?` matches exactly one character
 * - Path separators are normalized to `/`
 * - Trailing `" *"` is optional: `"ls *"` matches both `"ls"` and `"ls -la"`
 *
 * @param str - The string to test
 * @param pattern - The wildcard pattern
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
 *
 * Merges all provided rulesets and applies **last-matching-rule-wins** semantics.
 * If no rule matches, defaults to `{ action: "ask" }`.
 *
 * @param tool - The tool ID being evaluated
 * @param pattern - The argument pattern (e.g. file path)
 * @param rulesets - One or more rulesets to merge and evaluate (later sets take priority)
 * @returns The matching rule (or a synthetic default `ask` rule)
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
 * Returns the set of tool IDs that are unconditionally disabled by a `deny *` rule.
 * Useful for the TUI to grey out tools that can never run in this session.
 *
 * @param tools - The list of tool IDs to check
 * @param ruleset - The active ruleset to evaluate against
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
 * Evaluates the provided rulesets (plus any session-scope "always" approvals).
 *
 * - `"allow"` → returns immediately
 * - `"deny"` → throws {@link DeniedError}
 * - `"ask"` → emits a `permission-request` bus event and returns a Promise that
 *   resolves/rejects when {@link respond} is called by the TUI
 *
 * @param input.sessionId - The current session
 * @param input.permission - The permission category (typically the tool ID)
 * @param input.pattern - The resource pattern (e.g. file path)
 * @param input.ruleset - Ruleset to evaluate
 * @param input.metadata - Extra data for the TUI prompt
 *
 * @throws {@link DeniedError} If a `deny` rule matches
 * @throws {@link RejectedError} If the user rejects without feedback
 * @throws {@link CorrectedError} If the user rejects with feedback
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
 * Respond to a pending permission request from the TUI.
 *
 * - `"once"` — allow this single tool call, remove the pending request
 * - `"always"` — add a session-scope allow rule; auto-resolve any other pending requests now covered by it
 * - `"reject"` — reject with optional feedback message; also rejects all other pending requests for the session
 *
 * @param input.requestId - The ID of the {@link PendingRequest} to respond to
 * @param input.reply - The user's response
 * @param input.message - Optional feedback message (only meaningful when `reply` is `"reject"`)
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
 * Clear all permission state for a session.
 * Call this when a session ends to release in-memory state and reject any dangling pending requests.
 *
 * @param sessionId - The session to clear
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
