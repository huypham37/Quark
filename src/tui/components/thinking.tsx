// @jsxImportSource @opentui/solid
// ThinkingIndicator — shows collapsed thinking block with optional text content
//
// Matches the style:
//   ✓ Thinking ▶  (done)
//   ∷ Thinking ▶  (in-progress)
//
// When text is present, it is shown below the header in a dimmed/muted style,
// capped at 8 lines to avoid overwhelming the conversation view.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors, icons } from "../theme"

interface ThinkingIndicatorProps {
  done?: boolean
  text?: string
}

const MAX_THINKING_LINES = 8

export const ThinkingIndicator: Component<ThinkingIndicatorProps> = (props) => {
  // Trim and cap the thinking text to avoid very long blocks
  const displayText = () => {
    const t = props.text?.trim()
    if (!t) return ""
    const lines = t.split("\n")
    if (lines.length <= MAX_THINKING_LINES) return t
    return lines.slice(0, MAX_THINKING_LINES).join("\n") + "\n…"
  }

  return (
    <box flexDirection="column">
      {/* Header row: status icon + label */}
      <box flexDirection="row">
        <Show
          when={props.done}
          fallback={<text fg={colors.muted}>∷</text>}
        >
          <text fg={colors.success}>{icons.checkmark}</text>
        </Show>
        <text> Thinking </text>
        <text fg={colors.muted}>{icons.arrow}</text>
      </box>

      {/* Thinking content — shown when non-empty */}
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
