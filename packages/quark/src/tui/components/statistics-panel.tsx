// @jsxImportSource @opentui/solid
// StatisticsPanel — overlay window for /statistics chart display
//
// Renders the token usage chart in a bordered panel centered in the terminal.
// Closes on Escape or the provided onClose callback.

import type { Component } from "solid-js"
import { For, createEffect } from "solid-js"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"

interface StatisticsPanelProps {
  content: string
  onClose: () => void
}

const PANEL_WIDTH = 76
const PANEL_PADDING_X = 2
const PANEL_BG = RGBA.fromHex("#21252A")

export const StatisticsPanel: Component<StatisticsPanelProps> = (props) => {
  const dims = useTerminalDimensions()

  let scrollRef: ScrollBoxRenderable | undefined

  // Close on Escape
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onClose()
      evt.preventDefault()
    }
  })

  // Auto-scroll to top on new content
  createEffect(() => {
    props.content
    if (scrollRef) scrollRef.scrollTo(0)
  })

  const panelWidth = () => Math.min(PANEL_WIDTH, dims().width - 4)
  const contentWidth = () => panelWidth() - PANEL_PADDING_X * 2 - 2 // 2 for border

  // Max panel height: 80% of terminal height, capped at 40 rows
  const panelHeight = () => Math.min(Math.floor(dims().height * 0.8), 40)

  const lines = () => props.content.split("\n")

  // Trim each line to fit the panel width
  const trimLine = (line: string): string => {
    // The chart content uses Unicode box-drawing and full-block chars.
    // Each char is 1 cell wide, so we slice by character position.
    const max = contentWidth()
    return line.length <= max ? line : line.slice(0, max - 3) + "…"
  }

  return (
    <box
      position="absolute"
      top={Math.floor((dims().height - panelHeight()) / 2)}
      left={Math.floor((dims().width - panelWidth()) / 2)}
      width={panelWidth()}
      height={panelHeight()}
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.primary}
      backgroundColor={PANEL_BG}
      zIndex={1000}
    >
      {/* Title bar */}
      <box flexDirection="row" paddingX={1} paddingY={0} backgroundColor={PANEL_BG}>
        <text fg={colors.primary} bg={PANEL_BG} bold>Statistics</text>
        <box flexGrow={1} backgroundColor={PANEL_BG} />
        <text fg={colors.textDim} bg={PANEL_BG}>Esc to close</text>
      </box>

      {/* Separator */}
      <text fg={colors.muted} bg={PANEL_BG}>{`─`.repeat(panelWidth() - 4)}</text>

      {/* Scrollable content */}
      <scrollbox
        ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
        paddingX={1}
        backgroundColor={PANEL_BG}
        scrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" backgroundColor={PANEL_BG}>
          <For each={lines()}>
            {(line, idx) => {
              const trimmed = trimLine(line)
              return (
                <box height={1} backgroundColor={PANEL_BG}>
                  <text
                    fg={
                      idx() === 0 || idx() === 1 || idx() === 2
                        ? colors.primary
                        : colors.text
                    }
                    bg={PANEL_BG}
                    wrap="truncate"
                  >{trimmed || " "}</text>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}
