// @jsxImportSource @opentui/solid
// ToolResultContent — renders the body content of a completed/error/running tool call
//
// This is the inner content placed inside a ToolBox. It shows:
// - Tool label (file path, command, query, etc.)
// - Error message (if error)
// - Diff view (for edit/write completed)
// - Write stream view (for write running)
// - Tool output (for bash, read, grep, etc.)

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"
import { DiffView } from "./diff-view"
import { WriteStreamView } from "./write-stream-view"

interface ToolResultContentProps {
  tool: string
  input: Record<string, unknown>
  status: "completed" | "error" | "running" | "pending"
  output?: string
  error?: string
  diff?: string
  streamingContent?: string
}

const MAX_OUTPUT_SCROLL_HEIGHT = 20

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

// Truncate a single line for output display
function truncateLine(content: string, maxLen = 120): string {
  return content.length > maxLen ? content.slice(0, maxLen - 1) + "…" : content
}

const OutputView: Component<{ output: string }> = (props) => {
  const lines = () => props.output.split("\n")
  const scrollHeight = () => Math.min(lines().length, MAX_OUTPUT_SCROLL_HEIGHT)

  return (
    <scrollbox
      height={scrollHeight()}
      scrollbarOptions={{
        trackOptions: {
          backgroundColor: colors.scrollbarTrack,
          foregroundColor: colors.scrollbarThumb,
        },
      }}
    >
      <For each={lines()}>
        {(line) => <text fg={colors.textDim} wrap="wrap">{truncateLine(line)}</text>}
      </For>
    </scrollbox>
  )
}

export const ToolResultContent: Component<ToolResultContentProps> = (props) => {
  const label = () => getToolLabel(props.tool, props.input)

  // Determine if we should show output (bash, grep, glob, read, websearch, etc.)
  // Don't show output for tools that use diff or streaming content instead
  const showOutput = () => {
    if (!props.output) return false
    if (props.diff) return false // diff view takes precedence
    if (props.tool === "write" && props.streamingContent) return false
    return true
  }

  return (
    <box flexDirection="column">
      {/* Label row: file path, command, query, etc. */}
      <Show when={label()}>
        <text fg={RGBA.fromHex("#365A61")} underline wrap="wrap">{label()}</text>
      </Show>

      {/* Error message */}
      <Show when={props.error}>
        <text fg={colors.error}>{props.error}</text>
      </Show>

      {/* Write streaming content */}
      <Show when={props.tool === "write" && props.status === "running" && props.streamingContent}>
        <WriteStreamView
          content={props.streamingContent!}
          filePath={typeof (props.input.filePath ?? props.input.path) === "string" ? (props.input.filePath ?? props.input.path) as string : undefined}
        />
      </Show>

      {/* Diff view for completed edits/writes */}
      <Show when={props.diff && props.status === "completed"}>
        <DiffView
          diff={props.diff!}
          filePath={typeof props.input.filePath === "string" ? props.input.filePath : undefined}
        />
      </Show>

      {/* Tool output (bash stdout, read content, grep results, etc.) */}
      <Show when={showOutput()}>
        <OutputView output={props.output!} />
      </Show>
    </box>
  )
}
