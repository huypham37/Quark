// @jsxImportSource @opentui/solid
// ThinkingIndicator — shows thinking block with expandable text content
//
// Status indicator: static filled circle (●), color by state (matches ToolCard):
//   ● Thinking ▶                  (collapsed, click to expand)
//   ● Thinking ▼                  (expanded — shows thinking text below)
//   ● Thought for 5s ▼            (done, expanded)
//
// Click the header row to toggle per-indicator expansion.
// Ctrl+Shift+T sets the global default; per-item clicks override it.

import type { Component } from "solid-js"
import { Show, createSignal } from "solid-js"
import { colors, icons } from "../theme"

interface ThinkingIndicatorProps {
  done?: boolean
  text?: string
  /** Elapsed thinking time in ms; when present and done, shows "Thought for Ns". */
  durationMs?: number
  showText?: boolean
}

export const ThinkingIndicator: Component<ThinkingIndicatorProps> = (props) => {
  // Tri-state: undefined → follow global default; true/false → explicit override
  const [expandedOverride, setExpandedOverride] = createSignal<boolean | undefined>()

  const text = () => props.text?.trim() ?? ""
  const hasText = () => text().length > 0

  // Single source of truth for both chevron and content visibility
  const isExpanded = () => expandedOverride() ?? !!props.showText

  const toggleExpanded = () => {
    if (hasText()) setExpandedOverride(!isExpanded())
  }

  // Header label reflects state:
  //   in-progress → "Thinking"
  //   done w/ time → "Thought for N seconds"
  //   done no time → "Thought"
  const label = () => {
    if (!props.done) return "Thinking"
    if (props.durationMs != null) {
      const secs = Math.max(1, Math.round(props.durationMs / 1000))
      return `Thought for ${secs} second${secs === 1 ? "" : "s"}`
    }
    return "Thought"
  }

  // Static filled-circle status indicator.
  //   in-progress → light blue
  //   done        → green
  const statusColor = () => (props.done ? colors.success : colors.info)

  return (
    <box flexDirection="column">
      {/* Header row: status icon + label + expand/collapse indicator */}
      <box flexDirection="row" onMouseUp={toggleExpanded}>
        <text fg={statusColor()}>● </text>
        <text fg={colors.text}>{props.done ? <i>{label()} </i> : `${label()} `}</text>
        <Show when={hasText()}>
          <text fg={colors.muted}>{isExpanded() ? "▼" : icons.arrow}</text>
        </Show>
      </box>

      {/* Thinking content — shown when has text and is expanded */}
      <Show when={hasText() && isExpanded()}>
        <box flexDirection="column" paddingLeft={2}>
          <text fg={colors.muted}>{text()}</text>
        </box>
      </Show>
    </box>
  )
}
