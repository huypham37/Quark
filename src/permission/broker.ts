import { bus } from "../session/events"
import type { ParentControlMessage } from "../subagent/protocol"
import { respond as respondLocal, type Reply } from "./permission"

export interface RemotePermissionRegistration {
  sessionId: string
  messageId: string
  parentCallId: string
  profile: string
  childSessionId: string
  childRequestId: string
  tool: string
  pattern: string
  metadata?: Record<string, unknown>
  send(message: ParentControlMessage): Promise<void>
}

interface RemotePermission extends RemotePermissionRegistration {
  id: string
}

const remote = new Map<string, RemotePermission>()
let nextRemoteId = 0

function dismiss(requests: RemotePermission[]): void {
  if (requests.length === 0) return
  bus.emit("permission-dismiss", {
    sessionId: requests[0]!.sessionId,
    requestIds: requests.map((request) => request.id),
  })
}

export function registerRemotePermission(input: RemotePermissionRegistration): string {
  const id = `subperm_${++nextRemoteId}`
  remote.set(id, { ...input, id })
  bus.emit("permission-request", {
    sessionId: input.sessionId,
    requestId: id,
    tool: input.tool,
    input: { pattern: input.pattern, ...(input.metadata ?? {}) },
    origin: {
      kind: "subagent",
      parentCallId: input.parentCallId,
      profile: input.profile,
      childSessionId: input.childSessionId,
    },
  })
  return id
}

/** One response entry point for local and child-process permission requests. */
export function respondPermission(input: {
  requestId: string
  reply: Reply
  message?: string
}): void {
  const req = remote.get(input.requestId)
  if (!req) {
    respondLocal(input)
    return
  }

  remote.delete(input.requestId)
  if (input.reply === "always" || input.reply === "reject") {
    const related: RemotePermission[] = []
    for (const [id, other] of remote) {
      if (other.childSessionId !== req.childSessionId) continue
      if (input.reply === "always" && (other.tool !== req.tool || other.pattern !== req.pattern)) continue
      remote.delete(id)
      related.push(other)
    }
    dismiss(related)
  }
  req.send({
    type: "permission-response",
    requestId: req.childRequestId,
    reply: input.reply,
    ...(input.message ? { message: input.message } : {}),
  }).catch(() => {
    bus.emit("subagent-error", {
      sessionId: req.sessionId,
      messageId: req.messageId,
      parentCallId: req.parentCallId,
      profile: req.profile,
      kind: "process",
      message: "The subagent exited before the permission response could be delivered.",
    })
  })
}

/** Remove every remote request owned by a completed/failed child process. */
export function clearRemotePermissions(parentCallId: string, sessionId?: string): string[] {
  const removed: RemotePermission[] = []
  for (const [id, req] of remote) {
    if (req.parentCallId !== parentCallId || (sessionId && req.sessionId !== sessionId)) continue
    remote.delete(id)
    removed.push(req)
  }
  dismiss(removed)
  return removed.map((req) => req.id)
}

/** Clear parent-visible requests after a nested child reports local dismissals. */
export function clearRemotePermissionsByChildRequest(
  parentCallId: string,
  childRequestIds: string[],
): string[] {
  const ids = new Set(childRequestIds)
  const removed: RemotePermission[] = []
  for (const [id, req] of remote) {
    if (req.parentCallId !== parentCallId || !ids.has(req.childRequestId)) continue
    remote.delete(id)
    removed.push(req)
  }
  dismiss(removed)
  return removed.map((request) => request.id)
}

export function _resetRemotePermissions(): void {
  remote.clear()
  nextRemoteId = 0
}
