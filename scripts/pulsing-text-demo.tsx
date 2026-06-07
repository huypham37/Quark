// @jsxImportSource @opentui/solid
// Standalone demo for the isolated PulsingText component.
//
//   bun --preload ./preload.ts scripts/pulsing-text-demo.tsx
//
// Press Ctrl+C to exit.

import { render } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"
import { PulsingText } from "../src/tui/components/pulsing-text"
import { ShimmerText } from "../src/tui/components/shimmer-text"

const Demo = () => (
  <box flexDirection="column" padding={2} gap={1}>
    <PulsingText text="Thinking" />
    <ShimmerText text="Thinking" />
  </box>
)

const renderer = await createCliRenderer()
render(() => <Demo />, renderer)
