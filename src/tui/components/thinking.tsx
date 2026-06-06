// @jsxImportSource @opentui/solid
// ThinkingIndicator — shows collapsed thinking block with optional text content
//
// Status indicator: static filled circle (●), color by state (matches ToolCard):
//   ● Thinking ▶  (in-progress: light blue)
//   ● Thinking ▶  (done: green)
//
// When text is present, it is shown below the header in a dimmed/muted style.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors, icons } from "../theme"

interface ThinkingIndicatorProps {
  done?: boolean
  text?: string
  showText?: boolean
}

export const ThinkingIndicator: Component<ThinkingIndicatorProps> = (props) => {
  const displayText = () => (props.showText && props.text?.trim()) ? props.text.trim() : ""

  // Static filled-circle status indicator.
  //   in-progress → light blue
  //   done        → green
  const statusColor = () => (props.done ? colors.success : colors.info)

  return (
    <box flexDirection="column">
      {/* Header row: status icon + label */}
      <box flexDirection="row">
        <text fg={statusColor()}>● </text>
        <text fg={colors.text}>Thinking </text>
        <text fg={colors.muted}>{icons.arrow}</text>
      </box>

      {/* Thinking content — shown only when showText is true and text is non-empty */}
      <Show when={displayText()}>
        {(text: () => string) => (
          <box flexDirection="column" paddingLeft={2}>
            <text fg={colors.muted}>{text()}</text>
          </box>
        )}
      </Show>
    </box>
  )
}
