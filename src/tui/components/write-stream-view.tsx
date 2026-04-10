// @jsxImportSource @opentui/solid
// WriteStreamView — renders progressive write content as green-text lines
//
// Visual style (mirrors DiffView but shows only additions):
//
//   └── src/new-file.ts  +12
//       ─────────────────────────────────────
//          1│+import { foo } from "bar"
//          2│+
//          3│+export function main() {
//       ─────────────────────────────────────

import type { Component } from "solid-js"
import { For, Show, createEffect } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"

interface WriteStreamViewProps {
  content: string
  filePath?: string
}

const MAX_SCROLL_HEIGHT = 30

const COLOR_ADDED_FG = RGBA.fromHex("#98C379")
const COLOR_LINENUM  = RGBA.fromHex("#4a5568")
const COLOR_RULE     = RGBA.fromHex("#2d3748")
const COLOR_FILEPATH = RGBA.fromHex("#61AFEF")

function truncateLine(content: string, maxLen = 80): string {
  return content.length > maxLen ? content.slice(0, maxLen - 1) + "…" : content
}

export const WriteStreamView: Component<WriteStreamViewProps> = (props) => {
  const lines = () => props.content.split("\n")
  const scrollHeight = () => Math.min(lines().length, MAX_SCROLL_HEIGHT)
  const rule = "─".repeat(42)
  let scrollRef: ScrollBoxRenderable | undefined

  // Auto-scroll to bottom as new streaming content arrives
  createEffect(() => {
    const count = lines().length
    if (scrollRef && count > MAX_SCROLL_HEIGHT) {
      scrollRef.scrollTo(count - MAX_SCROLL_HEIGHT)
    }
  })

  return (
    <box flexDirection="column" marginLeft={2}>
      <box flexDirection="row">
        <text fg={colors.muted}>└── </text>
        <Show when={props.filePath}>
          <text fg={COLOR_FILEPATH}>{props.filePath!.replace(/^\/Users\/[^/]+\//, "~/")}</text>
          <text> </text>
        </Show>
        <text fg={COLOR_ADDED_FG}>+{lines().length}</text>
      </box>
      <box flexDirection="column" marginLeft={4}>
        <text fg={COLOR_RULE}>{rule}</text>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
          height={scrollHeight()}
          scrollbarOptions={{
            trackOptions: {
              backgroundColor: colors.scrollbarTrack,
              foregroundColor: colors.scrollbarThumb,
            },
          }}
        >
          <For each={lines()}>
            {(line, i) => (
              <box flexDirection="row">
                <text fg={COLOR_LINENUM}>{String(i() + 1).padStart(4)}</text>
                <text fg={colors.muted}>│</text>
                <text fg={COLOR_ADDED_FG}>+</text>
                <text fg={COLOR_ADDED_FG}>{truncateLine(line)}</text>
              </box>
            )}
          </For>
        </scrollbox>
        <text fg={COLOR_RULE}>{rule}</text>
      </box>
    </box>
  )
}
