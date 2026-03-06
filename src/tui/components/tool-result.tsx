// @jsxImportSource @opentui/solid
// ToolResultLine — shows completed/failed/pending tool call result
//
// Matches the style:
//   ✓ Read package.json
//   ✗ Write failed.txt
//   … Bash running...

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"

interface ToolResultLineProps {
  tool: string
  input: Record<string, unknown>
  status: "completed" | "error" | "running" | "pending"
  output?: string
  error?: string
}

// Extract a short label from tool input (e.g., file path for read/write/edit)
function getToolLabel(tool: string, input: Record<string, unknown>): string {
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === "string") {
    return path.replace(/^\/Users\/[^/]+\//, "~/")
  }

  const cmd = input.command ?? input.cmd
  if (typeof cmd === "string") {
    return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd
  }

  const name = input.name ?? input.skill
  if (typeof name === "string") return name

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

export const ToolResultLine: Component<ToolResultLineProps> = (props) => {
  const displayName = getToolDisplayName(props.tool)
  const label = () => getToolLabel(props.tool, props.input)
  const isPending = () => props.status === "pending" || props.status === "running"
  const isError = () => props.status === "error"

  return (
    <box flexDirection="row">
      <Show
        when={!isPending()}
        fallback={<text fg={colors.muted}>… </text>}
      >
        <Show
          when={!isError()}
          fallback={<text fg={colors.error}>✗</text>}
        >
          <text fg={RGBA.fromHex("#98C379")}>✓</text>
        </Show>
        <text> </text>
      </Show>
      <text bold>{displayName}</text>
      <Show when={label()}>
        <text> </text>
        <text fg={RGBA.fromHex("#365A61")} underline>{label()}</text>
      </Show>
      <Show when={props.error}>
        <text> </text>
        <text fg={colors.error}>({props.error})</text>
      </Show>
    </box>
  )
}
