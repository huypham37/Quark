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

// Parsed context item extracted from XML-style blocks
export interface ContextItem {
  type: "file" | "directory"
  path: string
  content?: string
  files?: { name: string; content?: string; isDir: boolean }[]
}

/**
 * Parse <directory> and <file> XML blocks from text and extract them.
 * Returns the cleaned text (without the XML blocks) and the list of items.
 */
export function parseContextBlocks(text: string): { cleaned: string; items: ContextItem[] } {
  const items: ContextItem[] = []

  // Extract <directory> blocks
  const dirRegex = /<directory path="([^"]+)">([\s\S]*?)<\/directory>/g
  let match: RegExpExecArray | null
  while ((match = dirRegex.exec(text)) !== null) {
    const path = match[1]!
    const body = match[2] ?? ""
    const files: { name: string; content?: string; isDir: boolean }[] = []

    // Parse <file> tags inside directory
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = fileRegex.exec(body)) !== null) {
      const fname = fileMatch[1]!
      const fcontent = fileMatch[2]
      files.push({ name: fname, content: fcontent, isDir: false })
    }

    // Parse <subdirectory> tags
    const subdirRegex = /<subdirectory name="([^"]+)"\s*\/>/g
    let subdirMatch: RegExpExecArray | null
    while ((subdirMatch = subdirRegex.exec(body)) !== null) {
      files.push({ name: subdirMatch[1] ?? "", isDir: true })
    }

    items.push({ type: "directory", path, files })
  }

  // Extract standalone <file> blocks (not inside directories)
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  while ((match = fileRegex.exec(text)) !== null) {
    // Skip if this was already captured inside a <directory> block
    const path = match[1]!
    const content = match[2]
    if (!items.some((i) => i.type === "file" && i.path === path)) {
      items.push({ type: "file", path, content })
    }
  }

  // Clean up the text by removing all XML blocks
  const cleaned = text
    .replace(/<directory[^>]*>[\s\S]*?<\/directory>/g, "")
    .replace(/<file[^>]*>[\s\S]*?<\/file>/g, "")
    .replace(/<subdirectory[^>]*\/>/g, "")
    .trim()

  return { cleaned, items }
}

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
    const size = props.item.content ? props.item.content.length : 0
    return `📄 ${props.item.path} · ${formatSize(size)}`
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
