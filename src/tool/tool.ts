// Tool contract — the universal interface every tool implements

import { z } from "zod"

export interface ToolContext {
  sessionId: string
  messageId: string
  abort: AbortSignal
  messages: any[] // full history for context-aware tools
  ask(permission: string, pattern: string): Promise<void> // throws if denied
}

export interface ToolResult {
  title: string
  output: string // returned to LLM as tool result
  metadata: Record<string, any>
}

export interface ToolDef<T extends z.ZodType = z.ZodType> {
  id: string
  description: string
  parameters: T
  execute(args: z.infer<T>, ctx: ToolContext): Promise<ToolResult>
}

export function defineTool<T extends z.ZodType>(def: ToolDef<T>): ToolDef<T> {
  return def
}
