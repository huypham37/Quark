// Tool registry — list of available tools with schema validation
//
// Tools are validated on registration to catch errors early.
// Invalid tools are rejected with descriptive error messages.

import { z } from "zod"
import type { ToolDef } from "./tool"

const registry = new Map<string, ToolDef>()

// Schema validation errors
export interface ToolValidationError {
  toolId: string
  field: string
  message: string
}

/**
 * Validate a tool definition
 * Returns null if valid, or an error object if invalid
 */
export function validateTool(tool: unknown): ToolValidationError | null {
  // Check it's an object
  if (!tool || typeof tool !== "object") {
    return { toolId: "unknown", field: "tool", message: "Tool must be an object" }
  }

  const t = tool as Record<string, unknown>

  // Check id
  if (typeof t.id !== "string" || t.id.trim() === "") {
    return { toolId: String(t.id ?? "unknown"), field: "id", message: "Tool must have a non-empty string 'id'" }
  }

  const toolId = t.id

  // Check description
  if (typeof t.description !== "string" || t.description.trim() === "") {
    return { toolId, field: "description", message: "Tool must have a non-empty string 'description'" }
  }

  // Check parameters is a Zod schema
  if (!t.parameters || typeof t.parameters !== "object") {
    return { toolId, field: "parameters", message: "Tool must have a 'parameters' Zod schema" }
  }

  // Check it's a ZodType by looking for _def (Zod internal)
  const params = t.parameters as Record<string, unknown>
  if (!("_def" in params)) {
    return { toolId, field: "parameters", message: "Tool 'parameters' must be a Zod schema (z.object, z.string, etc.)" }
  }

  // Check execute is a function
  if (typeof t.execute !== "function") {
    return { toolId, field: "execute", message: "Tool must have an 'execute' function" }
  }

  return null
}

/**
 * Register a tool with validation
 * Returns true if registered successfully, false if validation failed
 */
export function register(tool: ToolDef): { ok: true } | { ok: false; error: ToolValidationError } {
  const error = validateTool(tool)
  if (error) {
    return { ok: false, error }
  }

  // Check for duplicate registration
  if (registry.has(tool.id)) {
    return {
      ok: false,
      error: { toolId: tool.id, field: "id", message: `Tool '${tool.id}' is already registered` },
    }
  }

  registry.set(tool.id, tool)
  return { ok: true }
}

/**
 * Register a tool, throwing on validation error (legacy behavior)
 */
export function registerOrThrow(tool: ToolDef): void {
  const result = register(tool)
  if (!result.ok) {
    throw new Error(`Tool validation failed for '${result.error.toolId}': ${result.error.message}`)
  }
}

export function get(id: string): ToolDef | undefined {
  return registry.get(id)
}

export function list(): ToolDef[] {
  return Array.from(registry.values())
}

export function resolve(ids: string[]): ToolDef[] {
  return ids.map((id) => {
    const tool = registry.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    return tool
  })
}

/** Clear all registered tools (for testing) */
export function clear(): void {
  registry.clear()
}
