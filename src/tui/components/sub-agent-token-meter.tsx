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

const MAX_METER_SEGMENTS = 32
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
    return Math.min(100, Math.round(props.tokensUsed / props.tokenLimit * 100))
  }

  const tokenLabel = () => {
    if (props.tokensUsed <= 0) return ""
    const limit = props.tokenLimit > 0 ? ` / ${formatTokens(props.tokenLimit)}` : ""
    return `${formatTokens(props.tokensUsed)}${limit} tokens (${percentage()}%)`
  }

  const meterSegments = () => Math.max(
    4,
    Math.min(MAX_METER_SEGMENTS, Math.floor((dimensions().width * 0.5 - tokenLabel().length - 6) / METER_CELL.length)),
  )
  const filledSegments = () => Math.round(percentage() / 100 * meterSegments())

  return (
    <box flexDirection="row" backgroundColor={colors.commandCardBg}>
      <box flexDirection="row" flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden">
        <text fg={props.color}>{METER_CELL.repeat(filledSegments())}</text>
        <text fg={colors.border}>{METER_CELL.repeat(meterSegments() - filledSegments())}</text>
      </box>
      <text fg={colors.text} flexShrink={0}> {tokenLabel()}</text>
    </box>
  )
}
