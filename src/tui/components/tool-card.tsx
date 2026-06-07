// @jsxImportSource @opentui/solid
// ToolCard — unified tool rendering with header/body separation
//
// Header (always visible): status circle + tool name + args label
// Body (polymorphic by tool): WriteStreamView / DiffView / ScrollableOutput / empty
//
// Status indicator: static filled circle (●), color by status:
//   ● Bash  ~/deploy.sh           (running: yellow)
//   ● Read  ~/package.json        (completed: green)
//   ● Write  ~/out.ts (EACCES)    (error: red)
//   ● Read  ~/src/tool.ts         (pending: light blue)
//   ● Write  ~/out.ts             (awaiting_approval: light blue)

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"
import { DiffView } from "./diff-view"
import { WriteStreamView } from "./write-stream-view"
import { ScrollableOutput } from "./scrollable-output"
import { READ_ONLY_TOOLS } from "../../tool/tool"

interface ToolCardProps {
  tool: string
  status: "pending" | "awaiting_approval" | "running" | "completed" | "error"
  input: Record<string, unknown>
  output?: string
  error?: string
  diff?: string
  streamingContent?: string
}

// Extract a short label from tool input (e.g., file path for read/write/edit)
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
    question: "Question",
    webfetch: "WebFetch",
    "perplexity-search": "Perplexity",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

// ---------------------------------------------------------------------------
// Header: status icon + tool name + args label
// ---------------------------------------------------------------------------

const ToolCardHeader: Component<ToolCardProps> = (props) => {
  const displayName = () => getToolDisplayName(props.tool)
  const label = () => getToolLabel(props.tool, props.input)
  const isError = () => props.status === "error"

  // Static filled-circle status indicator.
  //   pending / awaiting_approval → light blue
  //   running                     → yellow
  //   completed                   → green
  //   error                       → red
  const statusColor = () => {
    switch (props.status) {
      case "completed":
        return colors.success
      case "error":
        return colors.error
      case "running":
        return colors.warning
      case "pending":
      case "awaiting_approval":
      default:
        return colors.info
    }
  }

  return (
    <box flexDirection="row">
      <box flexShrink={0}>
        <text fg={statusColor()}>● </text>
      </box>
      <text bold fg={colors.text} flexShrink={0}>{displayName()} </text>
      <Show when={label()}>
        <text fg={colors.toolPath} underline wrap="wrap" flexShrink={1}>{label()}</text>
      </Show>
      <Show when={props.error && isError()}>
        <text flexShrink={0}> </text>
        <text fg={colors.error} wrap="wrap" flexShrink={1}>({props.error})</text>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Body: polymorphic by tool + status
// ---------------------------------------------------------------------------

const ToolCardBody: Component<ToolCardProps> = (props) => {
  return (
    <>
      {/* Write tool streaming: progressive green lines */}
      <Show when={props.tool === "write" && props.status === "running" && props.streamingContent}>
        <WriteStreamView content={props.streamingContent!} />
      </Show>

      {/* Edit tool diff: unified diff view — shows at awaiting_approval (preview) and completed (canonical) */}
      <Show when={props.diff && (props.status === "completed" || props.status === "awaiting_approval")}>
        <DiffView diff={props.diff!} />
      </Show>

      {/* Output for terminal states (not write, not read-only, not pending/running/awaiting) */}
      <Show when={
        props.output &&
        props.status !== "awaiting_approval" &&
        props.status !== "running" &&
        props.status !== "pending" &&
        props.tool !== "write" &&
        !READ_ONLY_TOOLS.has(props.tool)
      }>
        <ScrollableOutput content={props.output!} />
      </Show>
    </>
  )
}

// ---------------------------------------------------------------------------
// ToolCard — composed header + body
// ---------------------------------------------------------------------------

export const ToolCard: Component<ToolCardProps> = (props) => {
  return (
    <box flexDirection="column">
      <ToolCardHeader {...props} />
      <ToolCardBody {...props} />
    </box>
  )
}
