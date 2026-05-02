// @jsxImportSource @opentui/solid
// ScrollableOutput — renders tool output in a scrollable box with a vertical scrollbar
//
// Visual style:
//
//   ─────────────────────────────────────
//   [… 487 lines]
//   Line 1 of output...
//   Line 2 of output...
//   ─────────────────────────────────────
//                                    ▲
//                                    █  (scrollbar)
//                                    ▽

import type { Component } from "solid-js"
import { For, createEffect, Show } from "solid-js"
import { RGBA } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { colors } from "../theme"

interface ScrollableOutputProps {
  content: string
  maxHeight?: number // default: 10 rows
}

const DEFAULT_MAX_HEIGHT = 5
const COLOR_RULE = RGBA.fromHex("#2d3748")

export const ScrollableOutput: Component<ScrollableOutputProps> = (props) => {
  const maxHeight = () => props.maxHeight ?? DEFAULT_MAX_HEIGHT
  const lines = () => props.content.split("\n")
  const totalLines = () => lines().length
  const visibleHeight = () => Math.min(totalLines(), maxHeight())
  const rule = "─".repeat(42)

  let scrollRef: ScrollBoxRenderable | undefined

  // Auto-scroll to bottom when content updates
  createEffect(() => {
    if (scrollRef && totalLines() > maxHeight()) {
      scrollRef.scrollTo(totalLines())
    }
  })

  return (
    <box flexDirection="column" marginLeft={2}>
      {/* Tree connector + rule line */}
      <box flexDirection="column" marginLeft={4}>
        <box flexDirection="row">
          <text fg={colors.muted}>└── </text>
          <Show when={totalLines() > maxHeight()}>
            <text fg={colors.muted}>[… {totalLines()} lines]</text>
          </Show>
        </box>
      </box>

      {/* Scrollable content */}
      <box flexDirection="column" marginLeft={4} height={visibleHeight()}>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
          height={visibleHeight()}
          scrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column">
            <For each={lines()}>
              {(line) => (
                <box flexDirection="row" height={1}>
                  <text fg={colors.textDim}>{line || " "}</text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
