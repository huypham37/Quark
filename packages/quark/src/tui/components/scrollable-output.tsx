// @jsxImportSource @opentui/solid
// ScrollableOutput — renders literal tool output in a bounded, scrollable viewport

import type { Component } from "solid-js"
import { For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme"
import { resultViewportCap } from "./result-viewport"

interface ScrollableOutputProps {
  content: string
  maxHeight?: number
  /** Follow appended output until the user manually scrolls away from the bottom. */
  followOutput?: boolean
}

export const ScrollableOutput: Component<ScrollableOutputProps> = (props) => {
  const dims = useTerminalDimensions()
  const lines = () => props.content.split("\n")
  const maxHeight = () => props.maxHeight ?? resultViewportCap(dims().height)
  const visibleHeight = () => Math.min(lines().length, maxHeight())

  return (
    <box flexDirection="column" marginLeft={2} marginTop={1} height={visibleHeight()}>
      <scrollbox
        height={visibleHeight()}
        stickyScroll={props.followOutput ?? false}
        stickyStart={props.followOutput ? "bottom" : undefined}
        scrollY={true}
        scrollX={false}
        verticalScrollbarOptions={{ showArrows: false }}
        horizontalScrollbarOptions={{ visible: false }}
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
  )
}
