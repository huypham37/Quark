// @jsxImportSource @opentui/solid
// ToolCard — unified tool rendering with header/body separation
//
// Header (always visible): status icon + tool name + args label
// Body (polymorphic by tool): WriteStreamView / DiffView / ScrollableOutput / empty
//
// Matches the style:
//   ⠋ Bash  ~/deploy.sh          (running: animated spinner)
//   ✓ Read  ~/package.json        (completed: green check)
//   ✗ Write  ~/out.ts (EACCES)    (error: red cross)
//   ⠋ Read  ~/src/tool.ts         (pending: braille cycle)
//   ? Write  ~/out.ts             (awaiting_approval: question mark)

import type { Component } from "solid-js"
import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"
import { InlineSpinner } from "./inline-spinner"
import { BRAILLE_CYCLE_FRAMES, BRAILLE_CYCLE_INTERVAL_MS } from "../spinner"
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
  const isPending = () => props.status === "pending"
  const isAwaiting = () => props.status === "awaiting_approval"
  const isRunning = () => props.status === "running"
  const isError = () => props.status === "error"

  // Braille cycle spinner for pending state (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
  const [pendingFrame, setPendingFrame] = createSignal(0)
  createEffect(() => {
    const id = setInterval(() => {
      if (!isPending()) return
      setPendingFrame((i) => (i + 1) % BRAILLE_CYCLE_FRAMES.length)
    }, BRAILLE_CYCLE_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })
  const pendingChar = () => BRAILLE_CYCLE_FRAMES[pendingFrame()]

  return (
    <box flexDirection="row">
      <box flexShrink={0}>
        <Show when={isRunning()}>
          <InlineSpinner />
        </Show>
        <Show when={isPending()}>
          <text fg={colors.textBold}>{pendingChar()} </text>
        </Show>
        <Show when={isAwaiting()}>
          <text fg={colors.text}>⏸ </text>
        </Show>
        <Show when={!isRunning() && !isPending() && !isAwaiting()}>
          <Show
            when={isError()}
            fallback={<text fg={RGBA.fromHex("#98C379")}>✓ </text>}
          >
            <text fg={colors.error}>✗ </text>
          </Show>
        </Show>
      </box>
      <text bold flexShrink={0}>{displayName()} </text>
      <Show when={label()}>
        <text fg={RGBA.fromHex("#365A61")} underline wrap="wrap" flexShrink={1}>{label()}</text>
      </Show>
      <Show when={props.error && isError()}>
        <text> </text>
        <text fg={colors.error}>({props.error})</text>
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
        <WriteStreamView
          content={props.streamingContent!}
          filePath={typeof (props.input.filePath ?? props.input.path) === "string" ? (props.input.filePath ?? props.input.path) as string : undefined}
        />
      </Show>

      {/* Edit tool diff: unified diff view */}
      <Show when={props.diff && props.status === "completed"}>
        <DiffView
          diff={props.diff!}
          filePath={typeof props.input.filePath === "string" ? props.input.filePath : undefined}
        />
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
