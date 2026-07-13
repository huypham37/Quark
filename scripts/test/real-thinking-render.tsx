#!/usr/bin/env bun
// @jsxImportSource @opentui/solid
// Render the ThinkingIndicator in a real terminal, first collapsed then expanded.

import { render } from "@opentui/solid"
import { createCliRenderer, RGBA } from "@opentui/core"
import { createComponent } from "solid-js"
import { ThinkingIndicator } from "../../src/tui/components/thinking.tsx"
import { applyTheme, darkTheme, setTerminalBg } from "../../src/tui/theme"

const renderer = createCliRenderer({
  width: 80,
  height: 12,
})

setTerminalBg(RGBA.fromHex("#1e1e1e"))
applyTheme(darkTheme)

render(
  () =>
    createComponent(ThinkingIndicator, {
      done: true,
      text: "I need to multiply 17 by 23.",
      durationMs: 5000,
      showText: false,
    }),
  renderer,
)

setTimeout(() => {
  render(
    () =>
      createComponent(ThinkingIndicator, {
        done: true,
        text: "I need to multiply 17 by 23.",
        durationMs: 5000,
        showText: true,
      }),
    renderer,
  )
}, 2000)

setTimeout(() => {
  process.exit(0)
}, 4000)
