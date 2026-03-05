// @jsxImportSource @opentui/solid
// ThinkingIndicator — shows collapsed thinking block
//
// Matches the style:
//   ✓ Thinking ▶  (done)
//   ∷ Thinking ▶  (in-progress)

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors, icons } from "../theme"

interface ThinkingIndicatorProps {
  done?: boolean
}

export const ThinkingIndicator: Component<ThinkingIndicatorProps> = (props) => {
  return (
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
  )
}
