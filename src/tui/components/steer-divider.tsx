// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { colors } from "../theme"

export const SteerDivider: Component<{ goal: string; width: number }> = (props) => {
  const label = ` Steered · ${props.goal} `
  const barChar = "━"
  const sideLen = Math.max(0, Math.floor((props.width - label.length) / 2))
  const left = barChar.repeat(sideLen)
  const right = barChar.repeat(Math.max(0, props.width - label.length - left.length))
  const line = left + label + right
  return (
    <text fg={colors.muted} italic>{line}</text>
  )
}
