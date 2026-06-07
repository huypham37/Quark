// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { colors } from "../theme"

export const SteerDivider: Component<{ goal: string }> = (props) => (
  <text fg={colors.muted} italic>
    {`━━━━━━━━━━━━━━━━━━━━━ Steered · ${props.goal} ━━━━━━━━━━━━━━━━━━━━━`}
  </text>
)
