// Quark — Minimal Coding Agent
// Entry point, exports public API

// Initialization
export { bootstrap, type BootstrapOptions } from "./bootstrap"

// Session management
export { createSession, getSession } from "./session/session"
export type { Session, SessionKind } from "./session/session"
// Core operations
export { prompt, cancel, isActive } from "./session/prompt"

export {
  createBranch,
  compactBranch,
  createSteerBranch,
  autoBranch,
  buildLineageContext,
  getSessionLineage,
  shouldBranchWithRealTokens,
  splitMessages,
} from "./session/branch"

// Tool system
export { register, list as listTools, type ToolValidationError } from "./tool/registry"
export { defineTool } from "./tool/tool"
export type { ToolDef, ToolContext, ToolResult, ToolResultContentPart } from "./tool/tool"

// Events
export { bus } from "./session/events"
export type { BusEvents, BusEventName } from "./session/events"

// Permissions
export {
  evaluate as evaluatePermission,
  ask as askPermission,
  listPending as listPendingPermissions,
  clearSession as clearPermissionSession,
  disabled as disabledTools,
  type Rule,
  type Ruleset,
  type Action,
  type Reply,
  type PendingRequest,
  DeniedError,
  RejectedError,
  CorrectedError,
} from "./permission/permission"
export { respondPermission } from "./permission/broker"

// Question tool
export { respondQuestion, type QuestionResponse } from "./tool/question"

// Agent configuration
export { defaultAgent, agentFromProfile, type AgentConfig } from "./agent"

// Profile management
export {
  resolveProfile,
  readPromptFile,
  listProfiles,
  setProfileThinking,
  resetProfileCache,
  type ProfileDef,
  type ProfileConfig,
  type PromptFileResult,
} from "./profile/profile"

// Plugin types (for authoring plugins)
export type { PluginFn, PluginContext, PluginHooks } from "./plugin/plugin"
