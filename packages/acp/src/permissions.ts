// ACP permission bridge (QUA-245).
//
// The engine executes a tool immediately once the model asks for it. ACP
// requires the agent to authorize sensitive operations with the client first,
// and — critically — to stop a denied operation BEFORE it runs. There is no
// engine "permission" hook, but `tool.execute.before` fires synchronously
// before a tool's `execute()` and may throw, which rejects the tool call into
// the engine's normal tool-error path. That is the seam used here:
//
//   tool.execute.before fires -> await client.requestPermission -> throw on deny
//
// so a denied tool never touches the workspace, and the model receives a tool
// error it can react to (no silent success, no post-hoc "you weren't allowed").
//
// Scope of a prompt:
//   * local read-only tools (read/grep/glob/skill/look/todo) never prompt.
//     Network tools need permission: URLs can carry workspace secrets.
//   * every other tool prompts — including MCP tools, whose effects are
//     unknown, so they default to asking.
//   * `question` is refused outright: it blocks on a bus event with no ACP
//     responder and would hang the turn; refusing it fails closed and lets the
//     model continue. (An elicitation bridge is future work.)
//
// `allow_always` is remembered per engine session (one runner == one ACP
// session), so a client that grants a tool once never sees it again this
// session. Context is keyed by the runner instance and the client is captured
// per turn, so two concurrent sessions never share a decision or a client.

import { methods } from "@agentclientprotocol/sdk"
import type {
  AgentContext,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolKind,
} from "@agentclientprotocol/sdk"
import type { Runner } from "@quark/runner"
import type { SessionTurn } from "./sessions"
import { createToolCallIds, type ToolCallIdScope } from "./tool-call-ids"

/** Tools that never need authorization: they cannot change the workspace. */
const SAFE_TOOLS = new Set([
  "read",
  "look",
  "grep",
  "glob",
  "skill",
  "todo",
  "todoread",
  "todowrite",
])

/**
 * Tools that cannot be bridged safely from ACP today. `question` waits on a
 * `question-request` bus event with no responder over ACP; refusing it prevents
 * an indefinite hang.
 */
const DENIED_TOOLS = new Set(["question"])

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject", kind: "reject_once" },
  { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
]

const TOOL_KINDS: Record<string, ToolKind> = {
  read: "read",
  look: "read",
  write: "edit",
  edit: "edit",
  grep: "search",
  glob: "search",
  websearch: "search",
  webfetch: "fetch",
  bash: "execute",
  todo: "think",
}

/** Per-session permission state. One instance per engine runner. */
interface SessionPermissionState {
  /** Tools the client granted with `allow_always` for this session. */
  always: Set<string>
  /** The turn currently running, or null between turns. */
  current: {
    client: AgentContext
    acpSessionId: string
    signal: AbortSignal
    /** QUA-265: maps a raw provider call id to the ACP card id for this turn. */
    callIds: ToolCallIdScope
  } | null
}

export interface PermissionBridge {
  /**
   * Capture the turn's client/signal and install the gate on the runner (once).
   * `callIds` (QUA-265) is the SAME per-turn scope the update bridge used, so
   * the permission card attaches to the `tool_call` card already created.
   */
  onTurnStart(turn: SessionTurn, callIds?: ToolCallIdScope): void
}

export interface PermissionBridgeOptions {
  /** Diagnostics sink (stderr in production). Defaults to no-op. */
  log?(message: string): void
}

/**
 * Build the permission gate. `onTurnStart` is wired from the composition root's
 * `SessionBridgeOptions.onTurnStart`, alongside the update bridge.
 */
export function createPermissionBridge(options: PermissionBridgeOptions = {}): PermissionBridge {
  const log = options.log ?? (() => {})
  const states = new WeakMap<object, SessionPermissionState>()
  const installed = new WeakSet<object>()
  // Fallback for direct callers/tests that don't pass a connection-scoped scope.
  const fallbackCallIds = createToolCallIds()

  function stateFor(runner: object): SessionPermissionState {
    let state = states.get(runner)
    if (!state) {
      state = { always: new Set(), current: null }
      states.set(runner, state)
    }
    return state
  }

  function install(runner: Runner): void {
    if (installed.has(runner)) return
    installed.add(runner)
    runner.hooks.register("tool.execute.before", async (input) => {
      const state = states.get(runner)
      const current = state?.current
      if (!current) {
        // No active ACP turn: executing here would be unmonitored. Fail closed.
        throw new Error(`permission bridge: tool "${input.tool}" attempted outside an ACP turn`)
      }
      if (current.signal.aborted) throw abortError()
      if (DENIED_TOOLS.has(input.tool)) {
        throw new Error(
          `tool "${input.tool}" is unavailable over ACP (no elicitation bridge); continue without it`,
        )
      }
      if (SAFE_TOOLS.has(input.tool) || state!.always.has(input.tool)) return

      const allowed = await askPermission(
        current,
        state!,
        input.tool,
        input.args,
        current.callIds.forRaw(input.callId ?? crypto.randomUUID()),
        log,
      )
      if (!allowed) throw new Error(`permission denied by the client for tool "${input.tool}"`)
    })
  }

  return {
    onTurnStart(turn, callIds) {
      const runner = turn.runner as Runner | undefined
      // Test doubles and any host that builds a runner without a hook registry
      // cannot be gated. The real engine always has one; log loudly if not.
      if (!runner?.hooks || typeof runner.hooks.register !== "function") {
        log("permission bridge: runner has no hook registry; tool permissions not enforced")
        return
      }
      install(runner)
      stateFor(runner).current = {
        client: turn.client,
        acpSessionId: turn.acpSessionId,
        signal: turn.signal,
        callIds: callIds ?? fallbackCallIds.startTurn(),
      }
    },
  }
}

async function askPermission(
  current: SessionPermissionState["current"] & object,
  state: SessionPermissionState,
  tool: string,
  args: Record<string, unknown>,
  callId: string,
  log: (message: string) => void,
): Promise<boolean> {
  const request: RequestPermissionRequest = {
    sessionId: current.acpSessionId,
    toolCall: {
      toolCallId: callId,
      title: tool,
      kind: TOOL_KINDS[tool] ?? "other",
      status: "pending",
      rawInput: args,
    },
    options: PERMISSION_OPTIONS,
  }

  let response: RequestPermissionResponse
  try {
    response = await raceAbort(
      current.client.request(methods.client.session.requestPermission, request),
      current.signal,
    )
  } catch (error) {
    if (isAbortError(error)) throw error
    // A transport failure must not become an approval.
    log(`permission request failed for "${tool}": ${messageOf(error)}`)
    return false
  }

  const outcome = response.outcome
  if (outcome.outcome !== "selected") return false
  const option = PERMISSION_OPTIONS.find((entry) => entry.optionId === outcome.optionId)
  if (!option) return false
  if (option.kind === "allow_always") state.always.add(tool)
  return option.kind === "allow_once" || option.kind === "allow_always"
}

/** Reject with an AbortError as soon as the turn is cancelled. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function abortError(): Error {
  return Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError"
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
