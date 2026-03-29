// @jsxImportSource @opentui/solid
// InlineSpinner — animated braille spinner for inline use in tool rows
//
// Uses the same frames and interval as FooterBar's spinner, but renders
// as a single character in white (not cyan) — indicating tool execution.

import type { Component } from "solid-js"
import { createSignal, createEffect, onCleanup } from "solid-js"
import { colors } from "../theme"
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../spinner"

export const InlineSpinner: Component = () => {
  const [frameIndex, setFrameIndex] = createSignal(0)

  createEffect(() => {
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  return <text fg={colors.textBold}>{SPINNER_FRAMES[frameIndex()]} </text>
}
