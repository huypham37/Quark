// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme"

interface SubAgentTokenMeterProps {
  tokensUsed: number
  tokenLimit: number
  color: string | RGBA
}

const METER_CELL = "▉"

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  const value = tokens / 1000
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}k`
}

export const SubAgentTokenMeter: Component<SubAgentTokenMeterProps> = (props) => {
  const dimensions = useTerminalDimensions()

  const percentage = () => {
    if (props.tokenLimit <= 0) return 0
    return Math.min(100, props.tokensUsed / props.tokenLimit * 100)
  }

  const displayPercentage = () => {
    const pct = percentage()
    if (props.tokensUsed <= 0) return "0%"
    if (pct < 1) return `${pct.toFixed(1)}%`
    return `${Math.round(pct)}%`
  }

  const tokenLabel = () => {
    const limit = props.tokenLimit > 0 ? ` / ${formatTokens(props.tokenLimit)}` : ""
    return `${formatTokens(props.tokensUsed)}${limit} tokens (${displayPercentage()})`
  }

  const filledFlex = () => {
    if (props.tokensUsed <= 0) return 0
    return Math.max(1, Math.round(percentage()))
  }
  const emptyFlex = () => 100 - filledFlex()
  const cellRun = () => METER_CELL.repeat(dimensions().width)

  return (
    <box flexDirection="row" height={1} backgroundColor={colors.commandCardBg}>
      <box flexDirection="row" flexGrow={filledFlex()} flexBasis={0} minWidth={filledFlex() > 0 ? 1 : 0} height={1} overflow="hidden">
        <text fg={props.color}>{cellRun()}</text>
      </box>
      <box flexDirection="row" flexGrow={emptyFlex()} flexBasis={0} minWidth={0} height={1} overflow="hidden">
        <text fg={colors.border}>{cellRun()}</text>
      </box>
      <text fg={colors.text} flexShrink={0}> {tokenLabel()}</text>
    </box>
  )
}
