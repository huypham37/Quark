// @jsxImportSource @opentui/solid
// UserMessage — renders user input with a cyan left border bar
//
// Parses <directory> and <file> XML blocks (injected by @ mention resolution)
// and renders them as compact chips instead of raw content.
//
// Matches the style:
//   | use oracle
//   | [📁 specs/ · 3 files] [📄 src/main.ts · 1.2kb]
//   | [Image 1] [Image 2]

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"
import { parseContextBlocks, type ContextItem } from "./mention-chips"

interface UserMessageProps {
  text: string
  images?: { label: string }[]
}

// Chip row for a single context mention
const MentionChip: Component<{ item: ContextItem }> = (props) => {
  const label = () => {
    if (props.item.type === "directory") {
      const fileCount = props.item.files?.filter((f) => !f.isDir).length ?? 0
      const dirCount = props.item.files?.filter((f) => f.isDir).length ?? 0
      let info = `📁 ${props.item.path}`
      if (fileCount > 0) info += ` · ${fileCount} file${fileCount > 1 ? "s" : ""}`
      if (dirCount > 0) info += ` · ${dirCount} dir${dirCount > 1 ? "s" : ""}`
      return info
    }
    const size = props.item.content ? props.item.content.length : 0
    const kb = (size / 1024).toFixed(1)
    return `📄 ${props.item.path} · ${kb}kb`
  }

  return (
    <box flexDirection="row" flexShrink={0} marginRight={1}>
      <text bg={colors.mentionChipBg} fg={colors.mentionChipFg}>
        {" "}
        {label()}{" "}
      </text>
    </box>
  )
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  const parsed = () => parseContextBlocks(props.text)

  return (
    <box flexDirection="column">
      {/* Text line */}
      <box flexDirection="row">
        <text fg={colors.userBar}>| </text>
        <text>{parsed().cleaned}</text>
      </box>

      {/* Mention chips — rendered below the text line */}
      <Show when={parsed().items.length > 0}>
        <box flexDirection="row" flexWrap="wrap" marginLeft={2} marginTop={0}>
          <For each={parsed().items}>
            {(item) => <MentionChip item={item} />}
          </For>
        </box>
      </Show>

      {/* Image chips */}
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
