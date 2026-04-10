// @jsxImportSource @opentui/solid
// ToolBox — bordered container for tool calls
//
// Visual style:
//   ╭─ Read ─────────────────────────────────────── ✓ ─╮
//   │ ~/project/src/auth.ts                             │
//   ╰───────────────────────────────────────────────────╯
//
//   ╭─ Bash ─────────────────────────────────────── ⠋ ─╮
//   │ npm test                                          │
//   │ > 42 pass  0 fail                                 │
//   ╰───────────────────────────────────────────────────╯

import type { Component, JSX } from "solid-js"
import { Show } from "solid-js"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"
import { InlineSpinner } from "./inline-spinner"

export type ToolBoxStatus = "pending" | "running" | "completed" | "error"

interface ToolBoxProps {
  tool: string
  status: ToolBoxStatus
  children?: JSX.Element
}

const COLOR_SUCCESS = RGBA.fromHex("#98C379")

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
    webfetch: "WebFetch",
    question: "Question",
    pm: "PM",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

function borderColor(status: ToolBoxStatus): RGBA {
  switch (status) {
    case "error": return colors.error
    case "completed": return colors.border
    case "running": return colors.borderActive
    case "pending": return colors.muted
  }
}

export const ToolBox: Component<ToolBoxProps> = (props) => {
  const displayName = getToolDisplayName(props.tool)
  const bc = () => borderColor(props.status)

  return (
    <box flexDirection="column">
      {/* Top border: ╭─ ToolName ──────────── ✓/✗/⠋/… ─╮ */}
      <box flexDirection="row" height={1} overflow="hidden">
        <text fg={bc()} flexShrink={0}>╭─ </text>
        <text fg={colors.text} bold flexShrink={0}>{displayName}</text>
        <text fg={bc()} flexShrink={0}> </text>
        <text fg={bc()} flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">{"─".repeat(300)}</text>
        <text fg={bc()} flexShrink={0}> </text>
        <Show when={props.status === "running" || props.status === "pending"}>
          <InlineSpinner />
        </Show>
        <Show when={props.status === "completed"}>
          <text fg={COLOR_SUCCESS}>✓</text>
        </Show>
        <Show when={props.status === "error"}>
          <text fg={colors.error}>✗</text>
        </Show>
        <text fg={bc()} flexShrink={0}> ─╮</text>
      </box>

      {/* Body with left/right/bottom border */}
      <box
        flexDirection="column"
        borderStyle="rounded"
        borderColor={bc()}
        border={["left", "right", "bottom"]}
        paddingX={1}
      >
        {props.children}
      </box>
    </box>
  )
}
