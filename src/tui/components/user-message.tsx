// @jsxImportSource @opentui/solid
// UserMessage — renders user input with a cyan left border bar
//
// Matches the style:
//   │ use oracle

import type { Component } from "solid-js"
import { colors } from "../theme"

interface UserMessageProps {
  text: string
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  return (
    <box flexDirection="row">
      <text fg={colors.userBar}>│ </text>
      <text italic>{props.text}</text>
    </box>
  )
}
