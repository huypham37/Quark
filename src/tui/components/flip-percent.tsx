// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { colors } from "../theme"
import {
  FLIP_DONE_FRAME,
  FLIP_PERCENT_INTERVAL_MS,
  flipPercentText,
  shouldAnimateTokenPercent,
} from "./flip-percent-frame"

export const FlipPercent: Component<{ value: number }> = (props) => {
  const [from, setFrom] = createSignal(props.value)
  const [to, setTo] = createSignal(props.value)
  const [frame, setFrame] = createSignal(FLIP_DONE_FRAME)
  let last = props.value
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  createEffect(() => {
    const next = props.value
    if (next === last) return

    const prev = last
    last = next
    stop()
    setFrom(prev)
    setTo(next)

    if (!shouldAnimateTokenPercent(prev, next)) {
      setFrame(FLIP_DONE_FRAME)
      return
    }

    setFrame(0)
    timer = setInterval(() => {
      setFrame((current) => {
        const nextFrame = Math.min(current + 1, FLIP_DONE_FRAME)
        if (nextFrame === FLIP_DONE_FRAME) stop()
        return nextFrame
      })
    }, FLIP_PERCENT_INTERVAL_MS)
  })

  onCleanup(stop)

  return (
    <text fg={colors.statusLine} flexShrink={0}>
      {flipPercentText(from(), to(), frame())}
    </text>
  )
}
