// @jsxImportSource @opentui/solid
// UserMessage — renders user input with a cyan left border bar
//
// Strips <directory> and <file> XML blocks (injected by @ mention resolution)
// from the displayed text. Mention chips are intentionally not rendered.

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"
import { parseContextBlocks } from "./mention-chips"

interface UserMessageProps {
  text: string
  images?: { label: string }[]
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  const cleaned = () => parseContextBlocks(props.text).cleaned

  return (
    <box flexDirection="column">
      {/* Text line */}
      <box flexDirection="row">
        <text fg={colors.userBar}>|</text>
        <text fg={colors.text}>{cleaned()}</text>
      </box>

      {/* Image chips */}
      <Show when={(props.images?.length ?? 0) > 0}>
        <box flexDirection="row">
          <text fg={colors.userBar}>|</text>
          <For each={props.images}>
            {(img) => <text fg={colors.success}>[{img.label}] </text>}
          </For>
        </box>
      </Show>
    </box>
  )
}
