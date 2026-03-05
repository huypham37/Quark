// @jsxImportSource @opentui/solid
// FooterBar — bottom bar showing running status and working directory
//
// Always renders 1 row to keep layout stable (no height jumps).
// When running: "~ Streaming response...    Esc to cancel"
// When idle: empty line
// Right side always shows abbreviated cwd path.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { colors } from "../theme"

export interface FooterBarProps {
  running: boolean
}

function abbreviatePath(fullPath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  if (home && fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length)
  }
  return fullPath
}

export const FooterBar: Component<FooterBarProps> = (props) => {
  const cwd = abbreviatePath(process.cwd())

  return (
    <box flexDirection="row" justifyContent="space-between" height={1}>
      <Show
        when={props.running}
        fallback={<text> </text>}
      >
        <box flexDirection="row">
          <text fg={colors.muted}>~ </text>
          <text>Streaming response...</text>
          <text>    </text>
          <text fg={colors.footerKey} bold>Esc</text>
          <text> to cancel</text>
        </box>
      </Show>
      <text fg={colors.muted}>{cwd}</text>
    </box>
  )
}
