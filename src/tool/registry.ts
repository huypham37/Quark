// Tool registry — list of available tools

import type { ToolDef } from "./tool"

const registry = new Map<string, ToolDef>()

export function register(tool: ToolDef) {
  registry.set(tool.id, tool)
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
