// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme"

interface SubAgentTokenMeterProps {
  tokensUsed: number
  tokenLimit: number
  color: string | RGBA
}

const METER_CELL = "▉"
const LEFT_END = "▌"
const RIGHT_END = "▐"

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

  // The meter lives inside a half-width card, so estimate the available width
  // as roughly half the terminal width minus the label and padding.
  const meterSegments = () => Math.max(
    4,
    Math.floor((dimensions().width - 1) * 0.5 - 5 - tokenLabel().length),
  )

  const filledSegments = () => {
    if (props.tokensUsed <= 0) return 0
    return Math.max(1, Math.round(percentage() / 100 * meterSegments()))
  }

  const leftColor = () => (filledSegments() > 0 ? props.color : colors.border)
  const rightColor = () => (filledSegments() === meterSegments() ? props.color : colors.border)
  const filledMiddle = () => Math.max(0, Math.min(filledSegments(), meterSegments() - 1) - 1)
  const emptyMiddle = () => Math.max(0, meterSegments() - 2 - filledMiddle())

  return (
    <box flexDirection="row" height={1} backgroundColor={colors.commandCardBg}>
      <box flexDirection="row" flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
        <Show when={meterSegments() >= 2}>
          <text fg={leftColor()}>{LEFT_END}</text>
          <Show when={filledMiddle() > 0}>
            <text fg={props.color}>{METER_CELL.repeat(filledMiddle())}</text>
          </Show>
          <Show when={emptyMiddle() > 0}>
            <text fg={colors.border}>{METER_CELL.repeat(emptyMiddle())}</text>
          </Show>
          <text fg={rightColor()}>{RIGHT_END}</text>
        </Show>
        <Show when={meterSegments() === 1}>
          <text fg={leftColor()}>{METER_CELL}</text>
        </Show>
      </box>
      <text fg={colors.text} flexShrink={0}> {tokenLabel()}</text>
    </box>
  )
}
