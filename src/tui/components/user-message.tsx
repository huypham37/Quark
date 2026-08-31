// @jsxImportSource @opentui/solid
// UserMessage — renders user input with a cyan left border bar
//
// Strips <directory> and <file> XML blocks (injected by @ mention resolution)
// from the displayed text. Mention chips are intentionally not rendered.

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"
import { parseContextBlocks } from "./mention-chips"
import type { UserMessageStatus } from "../state"

interface UserMessageProps {
  text: string
  images?: { label: string }[]
  status?: UserMessageStatus
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  const cleaned = () => parseContextBlocks(props.text).cleaned
  const failed = () => props.status === "aborted" || props.status === "failed"
  const italic = () => props.status !== undefined && props.status !== "sent"
  const foreground = () => failed() ? colors.error : props.status === "replied" ? colors.userBar : colors.text
  const barColor = () => failed() ? colors.error : colors.userBar

  return (
    <box flexDirection="column" border={["left"]} borderColor={barColor()} paddingLeft={1}>
      {/* Text line */}
      <text fg={foreground()}>{italic() ? <i>{cleaned()}</i> : cleaned()}</text>

      {/* Image chips */}
      <Show when={(props.images?.length ?? 0) > 0}>
        <box flexDirection="row">
          <For each={props.images}>
            {(img) => <text fg={failed() ? colors.error : colors.success}>[{img.label}] </text>}
          </For>
        </box>
      </Show>
    </box>
  )
}
