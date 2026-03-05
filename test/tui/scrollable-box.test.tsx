// ScrollableBox unit tests
//
// Validates that negative marginTop + overflow="hidden" + flexShrink=0
// produces correct scrolling behavior in Ink.
//
// Note: measureElement runs in useEffect, which fires after the first render.
// We need to wait for a re-render to see the correct scroll position.

import { describe, it, expect } from "bun:test"
import React from "react"
import { Text } from "ink"
import { render } from "ink-testing-library"
import { ScrollableBox } from "../../src/tui/components/primitives/ScrollableBox"

function makeLines(n: number, prefix = "Line"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(2, "0")}`)
}

function TestContent({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </>
  )
}

// Wait for Ink to process useEffect + re-render
const waitForRender = () => new Promise<void>((r) => setTimeout(r, 50))

describe("ScrollableBox", () => {
  it("shows first lines when scrollOffset is at max (scrolled to top)", async () => {
    const lines = makeLines(15)
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={7}>
        <TestContent lines={lines} />
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toContain("Line 01")
    expect(frame).toContain("Line 08")
    expect(frame).not.toContain("Line 09")
    unmount()
  })

  it("shows last lines when scrollOffset is 0 (pinned to bottom)", async () => {
    const lines = makeLines(15)
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={0}>
        <TestContent lines={lines} />
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toContain("Line 08")
    expect(frame).toContain("Line 15")
    expect(frame).not.toContain("Line 07")
    unmount()
  })

  it("shows middle window when partially scrolled", async () => {
    const lines = makeLines(15)
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={3}>
        <TestContent lines={lines} />
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toContain("Line 05")
    expect(frame).toContain("Line 12")
    expect(frame).not.toContain("Line 04")
    expect(frame).not.toContain("Line 13")
    unmount()
  })

  it("handles content shorter than viewport (no scrolling needed)", async () => {
    const lines = makeLines(5)
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={0}>
        <TestContent lines={lines} />
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toContain("Line 01")
    expect(frame).toContain("Line 05")
    unmount()
  })

  it("clamps scrollOffset to max (cannot scroll past top)", async () => {
    const lines = makeLines(15)
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={100}>
        <TestContent lines={lines} />
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toContain("Line 01")
    expect(frame).toContain("Line 08")
    expect(frame).not.toContain("Line 09")
    unmount()
  })

  it("handles empty content", async () => {
    const { lastFrame, unmount } = render(
      <ScrollableBox height={8} scrollOffset={0}>
        <Text> </Text>
      </ScrollableBox>,
    )
    await waitForRender()
    const frame = lastFrame()
    expect(frame).toBeDefined()
    unmount()
  })
})
