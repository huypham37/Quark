// @jsxImportSource @opentui/solid
// PermissionPrompt — renders when a tool needs user approval
//
// Shows a compact left-border prompt with the tool name,
// a human-readable label, and keyboard hints.
// Key handling (a/o/r) is done in App.tsx's global keyboard handler.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import type { PermissionRequest } from "../state"
import { colors } from "../theme"

export interface PermissionPromptProps {
  request: PermissionRequest
}

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
    question: "Question",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

function getToolLabel(tool: string, input: Record<string, unknown>): string {
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === "string") {
    const short = path.replace(/^\/Users\/[^/]+\//, "~/")
    if (tool === "read") {
      const offset = typeof input.offset === "number" ? input.offset : null
      const limit = typeof input.limit === "number" ? input.limit : null
      if (offset !== null || limit !== null) {
        const range = offset !== null && limit !== null
          ? `:${offset}+${limit}`
          : offset !== null ? `:${offset}` : `+${limit}`
        return `${short} ${range}`
      }
    }
    return short
  }

  const cmd = input.command ?? input.cmd
  if (typeof cmd === "string") return cmd

  const pattern = input.pattern
  if (typeof pattern === "string") return pattern

  const query = input.query
  if (typeof query === "string") return query

  const url = input.url
  if (typeof url === "string") return url

  const name = input.name ?? input.skill
  if (typeof name === "string") return name

  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0) return val
  }

  return ""
}

export const PermissionPrompt: Component<PermissionPromptProps> = (props) => {
  const displayName = () => getToolDisplayName(props.request.tool)
  const label = () => getToolLabel(props.request.tool, props.request.input)

  return (
    <box flexDirection="column" border={["left"]} borderColor={colors.warning}>
      <box flexDirection="row" paddingLeft={1}>
        <text fg={colors.warning}>▲ </text>
        <text bold fg={colors.text}>Allow {displayName()}?</text>
        <Show when={label()}>
          <text>  </text>
          <text fg={colors.toolPath}>{label()}</text>
        </Show>
      </box>
      <box flexDirection="row" gap={2} paddingLeft={1}>
        <box flexDirection="row">
          <text fg={colors.footerKey} bold>(a)</text>
          <text fg={colors.muted}> Always</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.footerKey} bold>(o)</text>
          <text fg={colors.muted}> Once</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.error} bold>(r)</text>
          <text fg={colors.muted}> Reject</text>
        </box>
      </box>
    </box>
  )
}
