// @jsxImportSource @opentui/solid
// MentionChips — renders compact chips for @file and @directory mentions
// extracted from XML-style context blocks injected by App.tsx handleSubmit().
//
// Replaces the raw <directory>/<file> content dump with:
//   [📁 specs/ 3 files]  [📄 specs/epics.json 1.2kb]
//
// Each chip can be expanded by pressing Enter to reveal its contents inline.

import type { Component } from "solid-js"
import { For, createSignal } from "solid-js"
import { colors } from "../theme"

import { parseContextBlocks, type ContextItem } from "./mention-context"
export { parseContextBlocks, type ContextItem }

/** Format a file size for display */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// Chip row for a single mention
interface MentionChipProps {
  item: ContextItem
  onSelect: (content: string) => void
}

const MentionChip: Component<MentionChipProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)

  const label = () => {
    if (props.item.type === "directory") {
      const fileCount = props.item.files?.filter((f) => !f.isDir).length ?? 0
      const dirCount = props.item.files?.filter((f) => f.isDir).length ?? 0
      let info = `📁 ${props.item.path}`
      if (fileCount > 0) info += ` · ${fileCount} file${fileCount > 1 ? "s" : ""}`
      if (dirCount > 0) info += ` · ${dirCount} dir${dirCount > 1 ? "s" : ""}`
      return info
    }
    if (!props.item.content) return `📄 ${props.item.path}`
    return `📄 ${props.item.path} · ${formatSize(props.item.content.length)}`
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <text bg={colors.mentionChipBg} fg={colors.mentionChipFg}>
          {" "}
          {label()}{" "}
        </text>
      </box>
    </box>
  )
}

interface MentionChipsProps {
  items: ContextItem[]
}

export const MentionChips: Component<MentionChipsProps> = (props) => {
  return (
    <box flexDirection="row" flexWrap="wrap">
      <For each={props.items}>
        {(item) => <MentionChip item={item} onSelect={() => {}} />}
      </For>
    </box>
  )
}
