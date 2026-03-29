// Quark — Minimal Coding Agent
// Entry point, exports public API

// Initialization
export { bootstrap } from "./bootstrap"

// Session management
export { createSession, getSession } from "./session/session"
export type { Session, SessionKind } from "./session/session"

// Core operations
export { prompt, cancel } from "./session/prompt"
export { compact } from "./session/compaction"

// Tool system
export { register, list as listTools } from "./tool/registry"
export { defineTool } from "./tool/tool"
export type { ToolDef, ToolContext, ToolResult } from "./tool/tool"

// Events
export { bus } from "./session/events"
export type { BusEvents, BusEventName } from "./session/events"

// Permissions
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

// Agent configuration
export { defaultAgent, agentFromProfile, type AgentConfig } from "./agent"

// Profile management
export {
  resolveProfile,
  readPromptFile,
  listProfiles,
  resetProfileCache,
  type ProfileDef,
  type ProfileConfig,
} from "./profile/profile"
