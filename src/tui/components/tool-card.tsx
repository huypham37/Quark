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

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors } from "../theme"
import { DiffView } from "./diff-view"
import { WriteStreamView } from "./write-stream-view"
import { ScrollableOutput } from "./scrollable-output"
import { READ_ONLY_TOOLS } from "../../tool/tool"

interface ToolCardProps {
  tool: string
  status: "pending" | "running" | "completed" | "error"
  input: Record<string, unknown>
  output?: string
  error?: string
  diff?: string
  streamingContent?: string
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

function getToolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    read: "Read", write: "Write", edit: "Edit", bash: "Bash", skill: "Skill",
    todo: "Todo", grep: "Grep", glob: "Glob", websearch: "WebSearch",
    question: "Question", webfetch: "WebFetch", "perplexity-search": "Perplexity",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

const ToolCardHeader: Component<ToolCardProps> = (props) => {
  const statusColor = () => {
    switch (props.status) {
      case "completed": return colors.success
      case "error": return colors.error
      case "running": return colors.warning
      default: return colors.info
    }
  }

  return (
    <box flexDirection="row">
      <box flexShrink={0}><text fg={statusColor()}>● </text></box>
      <text bold fg={colors.text} flexShrink={0}>{getToolDisplayName(props.tool)} </text>
      <Show when={getToolLabel(props.tool, props.input)}>
        <text fg={colors.toolPath} underline wrap="wrap" flexShrink={1}>{getToolLabel(props.tool, props.input)}</text>
      </Show>
      <Show when={props.error && props.status === "error"}>
        <text flexShrink={0}> </text>
        <text fg={colors.error} wrap="wrap" flexShrink={1}>({props.error})</text>
      </Show>
    </box>
  )
}

const ToolCardBody: Component<ToolCardProps> = (props) => {
  const hasCompletedDiff = () => props.status === "completed" && !!props.diff

  return (
    <>
      <Show when={props.tool === "write" && props.status === "running" && props.streamingContent}>
        <WriteStreamView content={props.streamingContent!} />
      </Show>
      <Show when={hasCompletedDiff()}>
        <DiffView diff={props.diff!} />
      </Show>
      <Show when={
        props.output
        && props.status !== "running"
        && props.status !== "pending"
        && props.tool !== "write"
        && !hasCompletedDiff()
        && !READ_ONLY_TOOLS.has(props.tool)
      }>
        <ScrollableOutput content={props.output!} />
      </Show>
    </>
  )
}

export const ToolCard: Component<ToolCardProps> = (props) => (
  <box flexDirection="column">
    <ToolCardHeader {...props} />
    <ToolCardBody {...props} />
  </box>
)
