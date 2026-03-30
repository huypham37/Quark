// @jsxImportSource @opentui/solid
// ToolResultLine — shows completed/failed/pending tool call result
//
// Matches the style:
//   ✓ Read package.json
//   ✗ Write failed.txt
//   ⠋ Bash running...   (animated white spinner when running)
//   … Bash             (muted ellipsis when pending/input streaming)

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"
import { InlineSpinner } from "./inline-spinner"
import { DiffView } from "./diff-view"

interface ToolResultLineProps {
  tool: string
  input: Record<string, unknown>
  status: "completed" | "error" | "running" | "pending"
  output?: string
  error?: string
  diff?: string
}

// Extract a short label from tool input (e.g., file path for read/write/edit)
function getToolLabel(tool: string, input: Record<string, unknown>): string {
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === "string") {
    return path.replace(/^\/Users\/[^/]+\//, "~/")
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

  // Generic fallback — first string value in the input object
  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0) return val
  }

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
    grep: "Grep",
    glob: "Glob",
    websearch: "WebSearch",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

export const ToolResultLine: Component<ToolResultLineProps> = (props) => {
  const displayName = getToolDisplayName(props.tool)
  const label = () => getToolLabel(props.tool, props.input)
  const isPending = () => props.status === "pending"
  const isRunning = () => props.status === "running"
  const isError = () => props.status === "error"

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box flexShrink={0}>
          <Show when={isRunning() || isPending()}>
            <InlineSpinner />
          </Show>
          <Show
            when={!isPending() && !isRunning()}
            fallback={null}
          >
            <Show
              when={!isError()}
              fallback={<text fg={colors.error}>✗ </text>}
            >
              <text fg={RGBA.fromHex("#98C379")}>✓ </text>
            </Show>
          </Show>
        </box>
        <text bold>{displayName}</text>
        <text> </text>
        <Show when={label()}>
          <text fg={RGBA.fromHex("#365A61")} underline wrap="wrap" flexShrink={1}>{label()}</text>
        </Show>
        <Show when={props.error}>
          <text> </text>
          <text fg={colors.error}>({props.error})</text>
        </Show>
      </box>
      <Show when={props.diff && props.status === "completed"}>
        <DiffView
          diff={props.diff!}
          filePath={typeof props.input.filePath === "string" ? props.input.filePath : undefined}
        />
      </Show>
    </box>
  )
}
