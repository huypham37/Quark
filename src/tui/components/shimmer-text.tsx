// @jsxImportSource @opentui/solid
// ShimmerText — per-letter variant of PulsingText.
//
// Instead of the whole word sharing one opacity, each character's animation
// phase is offset by `staggerMs`, so a bright highlight sweeps across the
// text like a wave (the classic "shimmer" loading effect).
//
// Same terminal trick as PulsingText: a terminal has no opacity, so every
// frame we blend the foreground over the background by an eased alpha and
// feed the resulting solid color to each character's `<text fg={...}>`.
//
// Self-contained — imports only solid-js and @opentui/core.

import type { Component } from "solid-js"
import { createSignal, createEffect, onCleanup, For } from "solid-js"
import { RGBA, parseColor } from "@opentui/core"
import type { ColorInput } from "@opentui/core"

export interface ShimmerTextProps {
  /** Text to animate. Default: "Thinking". */
  text?: string
  /** Foreground color (hex string or RGBA). Default: "#888888". */
  color?: ColorInput
  /** Background to blend against when faded (hex string or RGBA). Default: "#000000". */
  background?: ColorInput
  /** Full animation cycle length in ms. Default: 1500. */
  periodMs?: number
  /** Phase offset between adjacent letters in ms. Default: 90. */
  staggerMs?: number
  /** Opacity at the dim extreme. Default: 0.3. */
  minOpacity?: number
  /** Opacity at the bright extreme. Default: 1. */
  maxOpacity?: number
  /** Frame interval in ms. Default: 100. */
  frameMs?: number
}

function blend(fg: RGBA, bg: RGBA, alpha: number): RGBA {
  const r = bg.r + (fg.r - bg.r) * alpha
  const g = bg.g + (fg.g - bg.g) * alpha
  const b = bg.b + (fg.b - bg.b) * alpha
  return RGBA.fromValues(r, g, b, 1)
}

function easedOpacity(ms: number, periodMs: number, min: number, max: number): number {
  const phase = ((ms % periodMs) + periodMs) % periodMs / periodMs // 0..1, handles negatives
  const wave = (1 - Math.cos(2 * Math.PI * phase)) / 2 // 0..1, smooth ends
  return min + (max - min) * wave
}

export const ShimmerText: Component<ShimmerTextProps> = (props) => {
  const text = () => props.text ?? "Thinking"
  const fg = () => parseColor(props.color ?? "#888888")
  const bg = () => parseColor(props.background ?? "#000000")
  const periodMs = () => props.periodMs ?? 1500
  const staggerMs = () => props.staggerMs ?? 90
  const minOpacity = () => props.minOpacity ?? 0.3
  const maxOpacity = () => props.maxOpacity ?? 1
  const frameMs = () => props.frameMs ?? 100

  const [elapsed, setElapsed] = createSignal(0)

  createEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), frameMs())
    onCleanup(() => clearInterval(id))
  })

  // One <text> per character so each glyph can carry its own color. The bright
  // spot ripples left-to-right because each letter is offset by staggerMs.
  const chars = () => text().split("")

  return (
    <box flexDirection="row">
      <For each={chars()}>
        {(ch, i) => {
          const color = () => {
            const o = easedOpacity(elapsed() - i() * staggerMs(), periodMs(), minOpacity(), maxOpacity())
            return blend(fg(), bg(), o)
          }
          return <text fg={color()}>{ch}</text>
        }}
      </For>
    </box>
  )
}
