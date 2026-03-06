// @jsxImportSource @opentui/solid
// Prompt — input area with status line
//
// Uses OpenTUI's <input> renderable for single-line text input.
// Status line (tokens, cost, model, skills) is rendered above the input.
// App.tsx owns autocomplete state; this component just renders the input
// and forwards events upward.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { colors } from "../theme"

export interface PromptProps {
  /** Callback when user submits (Enter key) — receives trimmed text */
  onSubmit: (text: string) => void
  /** Callback on every keystroke with current input value */
  onInput: (text: string) => void
  /** Whether the input is disabled (agent running, permission prompt) */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Expose the InputRenderable ref to parent (for imperative .value set) */
  onRef?: (ref: InputRenderable) => void
  // Status info
  tokensUsed?: number
  tokenLimit?: number
  cost?: number
  modelName?: string
  skillCount?: number
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%"
  return `${Math.round((used / limit) * 100)}%`
}

export const Prompt: Component<PromptProps> = (props) => {
  const leftStatus = () => {
    const used = props.tokensUsed ?? 0
    const limit = props.tokenLimit ?? 168000
    const cost = props.cost ?? 0
    return `${formatPercent(used, limit)} of ${formatTokens(limit)} · $${cost.toFixed(2)} (free)`
  }

  const rightStatus = () => {
    const model = props.modelName ?? "smart"
    const skills = props.skillCount ?? 0
    return `${model}─${skills} skill${skills !== 1 ? "s" : ""}`
  }

  const borderColor = () => props.disabled ? colors.muted : colors.success

  const handleSubmit = (value: string) => {
    const text = value.trim()
    if (!text) return
    props.onSubmit(text)
  }

  const handleInput = (value: string) => {
    props.onInput(value)
  }

  const handleRef = (r: InputRenderable) => {
    props.onRef?.(r)
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Status line — single row, flex-based filler */}
      <box flexDirection="row" height={1} overflow="hidden">
        <text fg={borderColor()} flexShrink={0}>╭── </text>
        <text fg={colors.statusLine} flexShrink={0}>{leftStatus()}</text>
        <text fg={borderColor()} flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">{" " + "─".repeat(300) + " "}</text>
        <text fg={colors.statusLine} flexShrink={0}>{rightStatus()}</text>
        <text fg={borderColor()} flexShrink={0}> ──╮</text>
      </box>

      {/* Input box — no top border since status line acts as top edge */}
      <box
        flexDirection="column"
        borderStyle="rounded"
        borderColor={borderColor()}
        border={["left", "right", "bottom"]}
        paddingX={1}
        minHeight={4}
      >
        <Show
          when={!props.disabled}
          fallback={<text fg={colors.muted}>Agent is running... (Esc to cancel)</text>}
        >
          <input
            ref={handleRef}
            focused={!props.disabled}
            placeholder={props.placeholder ?? "Type a message..."}
            cursorColor={colors.cursorColor}
            cursorStyle={{ style: "line", blinking: true }}
            onSubmit={handleSubmit}
            onInput={handleInput}
          />
        </Show>
      </box>
    </box>
  )
}
