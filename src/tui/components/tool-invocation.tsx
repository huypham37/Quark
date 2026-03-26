// @jsxImportSource @opentui/solid
// ToolInvocationBlock — shows a tool being invoked with tree-line connector
//
// Matches the style:
//   ⠋ Oracle           (animated white spinner while running)
//   └── Explore and analyze the codebase structure...

import type { Component } from "solid-js"
import { TreeLine } from "./tree-line"
import { InlineSpinner } from "./inline-spinner"
import { colors } from "../theme"

interface ToolInvocationBlockProps {
  tool: string
  description: string
}

// Map tool IDs to display names
function getToolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    read: "Read",
    write: "Write",
    edit: "Edit",
    bash: "Bash",
    skill: "Skill",
    todo: "Todo",
    grep: "Grep",
    glob: "Glob",
    websearch: "WebSearch",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

export const ToolInvocationBlock: Component<ToolInvocationBlockProps> = (props) => {
  const displayName = getToolDisplayName(props.tool)

  return (
    <TreeLine label={displayName} labelColor={colors.text} spinning>
      <text dimColor>{props.description}</text>
    </TreeLine>
  )
}
