// ToolResultLine — shows completed/failed tool call result
//
// Matches Amp's style:
//   ✓ Read package.json
//   ✗ Write failed.txt

import React from "react"
import { Box, Text } from "ink"
import { Checkmark, Cross } from "../primitives/Icon"
import { colors } from "../../theme"

interface ToolResultLineProps {
  tool: string
  input: Record<string, unknown>
  status: "completed" | "error" | "running" | "pending"
  output?: string
  error?: string
}

// Extract a short label from tool input (e.g., file path for read/write/edit)
function getToolLabel(tool: string, input: Record<string, unknown>): string {
  // For file tools, show the path
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === "string") {
    // Shorten home directory
    const short = path.replace(/^\/Users\/[^/]+\//, "~/")
    return short
  }

  // For bash, show the command (truncated)
  const cmd = input.command ?? input.cmd
  if (typeof cmd === "string") {
    const truncated = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd
    return truncated
  }

  // For skill tool
  const name = input.name ?? input.skill
  if (typeof name === "string") return name

  // Fallback: show tool name
  return ""
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

export function ToolResultLine({ tool, input, status, output, error }: ToolResultLineProps) {
  const displayName = getToolDisplayName(tool)
  const label = getToolLabel(tool, input)

  const icon = status === "error" ? <Cross /> : <Checkmark />

  return (
    <Box>
      {status === "pending" || status === "running" ? (
        <Text color={colors.muted}>… </Text>
      ) : (
        <>{icon}<Text> </Text></>
      )}
      <Text bold>{displayName}</Text>
      {label ? (
        <>
          <Text> </Text>
          <Text color={colors.toolPath} underline>{label}</Text>
        </>
      ) : null}
      {error ? (
        <>
          <Text> </Text>
          <Text color={colors.error}>({error})</Text>
        </>
      ) : null}
    </Box>
  )
}
