// Quark — Minimal Coding Agent
// Entry point, exports public API

// Session management
export { createSession, getSession, defaultSessionStore } from "./session/session"
export type { Session, SessionKind } from "./session/session"
// Session persistence contract (instance-scoped via createRunner)
export { MemorySessionStore } from "./session/store"
export type { SessionStore } from "./session/store"
// Core operations
export { prompt, cancel, isActive } from "./session/prompt"
export { PORTABLE_POLICIES, type RunPolicies } from "./session/policies"
export type { AmbientInstructions, AmbientPromptBuilder } from "./session/system"

// Instance-based runner (isolated bus + cancellation per agent)
export { createRunner } from "./runner"
export type {
  Runner,
  RunnerOptions,
  RunnerExecute,
  RunnerExecuteContext,
  RunnerPromptInput,
  RunnerSeedExecute,
  RunnerSeedInput,
} from "./runner"

// Typed event bus (instance-owned buses are exposed on Runner)
export { TypedBus } from "./session/events"

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
export { register, validateTool, list as listTools, type ToolValidationError } from "./tool/registry"
export { defineTool } from "./tool/tool"
export type { ToolDef, ToolContext, ToolResult, ToolResultContentPart } from "./tool/tool"

// Events
export { bus } from "./session/events"
export type { BusEvents, BusEventName } from "./session/events"

// Question tool
export { respondQuestion, type QuestionResponse } from "./tool/question"

// Agent definition
export {
  defineAgent,
  type AgentDefinition,
} from "./agent"
export type { SkillDefinition } from "./skill/skill"

// Plugin types (for authoring plugins)
export type { PluginFn, PluginContext, PluginHooks, HookHandlers } from "./plugin/plugin"

// Hook registry — instance-scoped collections passed to createRunner
export { createHookRegistry, globalHooks, type HookRegistry } from "./plugin/registry"
