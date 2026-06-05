// @jsxImportSource @opentui/solid
// ThinkingIndicator — shows collapsed thinking block with optional text content
//
// Matches the style:
//   ✓ Thinking ▶  (done)
//   ∷ Thinking ▶  (in-progress)
//
// When text is present, it is shown below the header in a dimmed/muted style.

import type { Component } from "solid-js"
import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { colors, icons } from "../theme"
import { BRAILLE_CYCLE_FRAMES, BRAILLE_CYCLE_INTERVAL_MS } from "../spinner"

interface ThinkingIndicatorProps {
  done?: boolean
  text?: string
  showText?: boolean
}

export const ThinkingIndicator: Component<ThinkingIndicatorProps> = (props) => {
  const displayText = () => (props.showText && props.text?.trim()) ? props.text.trim() : ""

  // Animated braille spinner for in-progress thinking
  const [frameIndex, setFrameIndex] = createSignal(0)
  createEffect(() => {
    if (props.done) return
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % BRAILLE_CYCLE_FRAMES.length)
    }, BRAILLE_CYCLE_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  return (
    <box flexDirection="column">
      {/* Header row: status icon + label */}
      <box flexDirection="row">
        <Show
          when={props.done}
          fallback={<text fg={colors.muted}>{BRAILLE_CYCLE_FRAMES[frameIndex()]}</text>}
        >
          <text fg={colors.success}>{icons.checkmark}</text>
        </Show>
        <text> Thinking </text>
        <text fg={colors.muted}>{icons.arrow}</text>
      </box>

      {/* Thinking content — shown only when showText is true and text is non-empty */}
      <Show when={displayText()}>
        {(text: () => string) => (
          <box flexDirection="column" paddingLeft={2}>
            <text fg={colors.muted}>{text()}</text>
          </box>
        )}
      </Show>
    </box>
  )
}
