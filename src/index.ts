// Atom — Minimal Coding Agent
// Entry point, exports public API

export { bootstrap } from "./bootstrap"
export { createSession, getSession } from "./session/session"
export { prompt, cancel } from "./session/prompt"
export { compact } from "./session/compaction"
export { register, list as listTools } from "./tool/registry"
export { bus } from "./session/events"
export type { BusEvents, BusEventName } from "./session/events"
export {
  evaluate as evaluatePermission,
  ask as askPermission,
  respond as respondPermission,
  listPending as listPendingPermissions,
  clearSession as clearPermissionSession,
  disabled as disabledTools,
  type Rule,
  type Ruleset,
  type Action,
  type Reply,
} from "./permission/permission"
