// ToolInvocationBlock — shows a tool being invoked with tree-line connector
//
// Matches Amp's style:
//   · Oracle
//   └── Explore and analyze the codebase structure under /Users/mac/01-CodeSpace/
//       to understand the overall architecture...

import React from "react"
import { Box, Text } from "ink"
import { TreeLine } from "../primitives/TreeLine"
import { colors } from "../../theme"

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
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

export function ToolInvocationBlock({ tool, description }: ToolInvocationBlockProps) {
  const displayName = getToolDisplayName(tool)

  return (
    <TreeLine label={displayName} labelColor={colors.text}>
      <Text dimColor wrap="wrap">{description}</Text>
    </TreeLine>
  )
}
