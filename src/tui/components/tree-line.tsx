// @jsxImportSource @opentui/solid
// TreeLine — renders tree-style connectors for tool invocation blocks
//
// Matches the style:
//   · Oracle
//   └── description text here

import type { Component, JSX } from "solid-js"
import type { ColorInput } from "../theme"
import { colors, icons } from "../theme"

interface TreeLineProps {
  label: string
  labelColor?: ColorInput
  children: JSX.Element
}

export const TreeLine: Component<TreeLineProps> = (props) => {
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={colors.muted}>{icons.dot} </text>
        <text bold fg={props.labelColor}>{props.label}</text>
      </box>
      <box flexDirection="row">
        <text fg={colors.muted}>{icons.treeCorner} </text>
        <box flexDirection="column" flexShrink={1}>
          {props.children}
        </box>
      </box>
    </box>
  )
}
