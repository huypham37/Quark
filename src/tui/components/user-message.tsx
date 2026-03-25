// @jsxImportSource @opentui/solid
// UserMessage — renders user input with a cyan left border bar
//
// Matches the style:
//   | use oracle
//   | [Image 1] [Image 2]

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"

interface UserMessageProps {
  text: string
  images?: { label: string }[]
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={colors.userBar}>| </text>
        <text>{props.text}</text>
      </box>
      <Show when={(props.images?.length ?? 0) > 0}>
        <box flexDirection="row">
          <text fg={colors.userBar}>| </text>
          <For each={props.images}>
            {(img) => <text fg={colors.success}>[{img.label}] </text>}
          </For>
        </box>
      </Show>
    </box>
  )
}
