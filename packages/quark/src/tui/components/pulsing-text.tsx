// @jsxImportSource @opentui/solid
// PulsingText — terminal port of the CSS "pulsing text" animation.
//
// CSS reference (the effect we are reproducing):
//
//   .thinking-text {
//     color: #888;
//     animation: pulse 1.5s infinite ease-in-out;
//   }
//   @keyframes pulse {
//     0%, 100% { opacity: 0.3; }
//     50%      { opacity: 1;   }
//   }
//
// A terminal has no real opacity, so we *simulate* it: every animation tick
// we blend the foreground color over the background color by the current
// eased opacity and feed the resulting solid color to `<text fg={...}>`.
// On a black background this looks identical to CSS opacity fading.
//
// This component is intentionally self-contained — it does NOT import the
// project theme, spinner, or any other module — so it can be dropped into
// any OpenTUI/SolidJS app unchanged.

import type { Component } from "solid-js"
import { createSignal, createEffect, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"

export interface PulsingTextProps {
  /** Text to animate. Default: "Thinking". */
  text?: string
  /** Foreground color hex (the "#888" in the CSS). Default: "#888888". */
  color?: string
  /** Background to blend against when faded, hex. Default: "#000000". */
  background?: string
  /** Full animation cycle length in ms (CSS `1.5s`). Default: 1500. */
  periodMs?: number
  /** Opacity at the dim extreme (CSS `0.3`). Default: 0.3. */
  minOpacity?: number
  /** Opacity at the bright extreme (CSS `1`). Default: 1. */
  maxOpacity?: number
  /** Frame interval in ms. Lower = smoother, more CPU. Default: 50. */
  frameMs?: number
}

// Blend `fg` over `bg` by `alpha` (0..1) — the terminal stand-in for opacity.
function blend(fg: RGBA, bg: RGBA, alpha: number): RGBA {
  const r = bg.r + (fg.r - bg.r) * alpha
  const g = bg.g + (fg.g - bg.g) * alpha
  const b = bg.b + (fg.b - bg.b) * alpha
  return RGBA.fromValues(r, g, b, 1)
}

// Eased opacity at elapsed time `ms`. Reproduces the 0.3 → 1 → 0.3 pulse with
// an ease-in-out feel via a raised cosine (smooth at both extremes):
//   phase 0   → min   (0%/100% keyframe)
//   phase 0.5 → max   (50% keyframe)
function easedOpacity(ms: number, periodMs: number, min: number, max: number): number {
  const phase = (ms % periodMs) / periodMs // 0..1
  const wave = (1 - Math.cos(2 * Math.PI * phase)) / 2 // 0..1, smooth ends
  return min + (max - min) * wave
}

export const PulsingText: Component<PulsingTextProps> = (props) => {
  const text = () => props.text ?? "Thinking"
  const fg = () => RGBA.fromHex(props.color ?? "#888888")
  const bg = () => RGBA.fromHex(props.background ?? "#000000")
  const periodMs = () => props.periodMs ?? 1500
  const minOpacity = () => props.minOpacity ?? 0.3
  const maxOpacity = () => props.maxOpacity ?? 1
  const frameMs = () => props.frameMs ?? 50

  const [color, setColor] = createSignal<RGBA>(fg())

  createEffect(() => {
    const start = Date.now()
    const id = setInterval(() => {
      const o = easedOpacity(Date.now() - start, periodMs(), minOpacity(), maxOpacity())
      setColor(blend(fg(), bg(), o))
    }, frameMs())
    onCleanup(() => clearInterval(id))
  })

  return <text fg={color()}>{text()}</text>
}
