// @jsxImportSource @opentui/solid

import type { Component, JSX } from "solid-js"
import { colors } from "../theme"

interface CommandCardProps {
  height: number
  children: JSX.Element
}

export const CommandCard: Component<CommandCardProps> = (props) => (
  <box
    flexDirection="column"
    height={props.height}
    paddingX={1}
    borderStyle="rounded"
    borderColor={colors.outline}
    backgroundColor={colors.commandCardBg}
  >
    {props.children}
  </box>
)
