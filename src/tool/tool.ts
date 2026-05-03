// Tool contract — the universal interface every tool implements

import { z } from "zod"

/**
 * A single content part that a tool can return in its output.
 * When a tool returns an array of these instead of a plain string,
 * the result is sent to the LLM provider as multi-modal content
 * (e.g. text + images).
 */
export type ToolResultContentPart =
  | { type: "text"; text: string }
  | { type: "image-data"; data: string; mediaType: string }

/**
 * Execution context passed to every tool's `execute` function.
 */
export interface ToolContext {
  /** ID of the session this tool call belongs to */
  sessionId: string
  /** ID of the assistant message that triggered this tool call */
  messageId: string
  /** AI SDK tool call ID — used to link sub-agent events to parent tool invocations */
  callId: string
  /** AbortSignal — tool should respect cancellation */
  abort: AbortSignal
  /**
   * Request permission before performing a sensitive operation.
   * Throws {@link DeniedError} or {@link RejectedError} if denied.
   *
   * @param tool - The tool ID being checked
   * @param pattern - The specific resource pattern being accessed (e.g. a file path)
   */
  ask(tool: string, pattern: string): Promise<void>
}

/**
 * The value a tool's `execute` function must return.
 */
export interface ToolResult {
  /** Short human-readable label shown in the TUI tool call header */
  title: string
  /** The content returned to the LLM as the tool result.
   *  - `string` — plain text (backward compatible)
   *  - `ToolResultContentPart[]` — multi-modal content (text + images)
   */
  output: string | ToolResultContentPart[]
  /** Arbitrary metadata for TUI rendering (e.g. `{ diff: "..." }`) */
  metadata: Record<string, any>
}

/**
 * The universal tool definition interface.
 * Every tool — built-in or external — must conform to this shape.
 *
 * @typeParam T - Zod schema type for the tool's input parameters
 *
 * @example
 * ```ts
 * import { defineTool } from '@quark/sdk'
 * import { z } from 'zod'
 *
 * const greetTool = defineTool({
 *   id: 'greet',
 *   description: 'Greet someone by name',
 *   parameters: z.object({ name: z.string() }),
 *   async execute({ name }) {
 *     return { title: 'Greet', output: `Hello, ${name}!`, metadata: {} }
 *   }
 * })
 * ```
 */
export interface ToolDef<T extends z.ZodType = z.ZodType> {
  /** Unique tool identifier used in profile declarations and the tool registry */
  id: string
  /** Human-readable description sent to the LLM to explain what this tool does */
  description: string
  /** Zod schema defining the tool's input parameters */
  parameters: T
  /**
   * Execute the tool.
   * @param args - Validated input arguments (inferred from `parameters`)
   * @param ctx - Execution context with session info, abort signal, and permission API
   */
  execute(args: z.infer<T>, ctx: ToolContext): Promise<ToolResult>
}

/**
 * Identity helper that returns the tool definition unchanged.
 * Provides TypeScript type inference for the `parameters` schema.
 *
 * @param def - The tool definition
 * @returns The same definition, typed correctly
 */
export function defineTool<T extends z.ZodType>(def: ToolDef<T>): ToolDef<T> {
  return def
}

/**
 * Set of tool IDs that are read-only — they don't modify filesystem state,
 * network state, or any persistent resource.
 *
 * Used by the TUI to render these tools as header-only (status + tool name
 * + label) without the full output body. This keeps the conversation view
 * clean for tools that produce large, repetitive output (file contents,
 * search results, skill content).
 */
export const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "websearch",
  "webfetch",
  "perplexity-search",
  "skill",
])
