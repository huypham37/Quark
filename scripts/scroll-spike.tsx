// Spike test v3: Final validation of ScrollableBox approach
//
// Tests:
// 1. flexShrink=0 + negative marginTop + overflow=hidden → correct scrolling
// 2. measureElement returns the real content height (not the clamped viewport height)
// 3. Dynamic content height works (simulating streaming messages)
//
// Run: bunx tsx scripts/scroll-spike.tsx

import React, { useRef, useEffect, useState } from "react"
import { Box, Text, measureElement } from "ink"
import { render } from "ink-testing-library"

const VIEWPORT = 8

// Test 1: Basic scrolling with flexShrink=0
function BasicScroll({ marginTop, lines }: { marginTop: number; lines: string[] }) {
  return (
    <Box height={VIEWPORT} flexDirection="column" overflow="hidden">
      <Box flexDirection="column" marginTop={marginTop} flexShrink={0}>
        {lines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

// Test 2: measureElement reports full content height
let measuredHeight = -1
function MeasureTest({ lines }: { lines: string[] }) {
  const ref = useRef(null)
  
  useEffect(() => {
    if (ref.current) {
      const { height } = measureElement(ref.current)
      measuredHeight = height
    }
  })
  
  return (
    <Box height={VIEWPORT} flexDirection="column" overflow="hidden">
      <Box ref={ref} flexDirection="column" flexShrink={0}>
        {lines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

// ───────────── Run tests ─────────────

const lines15 = Array.from({ length: 15 }, (_, i) => `Msg ${String(i + 1).padStart(2, "0")}`)
const lines5 = Array.from({ length: 5 }, (_, i) => `Short ${String(i + 1).padStart(2, "0")}`)

console.log("=== Scroll Spike Test v3 (Final Validation) ===\n")

// --- Test 1a: Pinned to bottom (marginTop = -(15 - 8) = -7)
{
  console.log("Test 1a: 15 lines, viewport=8, pinned to bottom (marginTop=-7)")
  console.log("Expect: Msg 08 through Msg 15")
  const { lastFrame, unmount } = render(<BasicScroll marginTop={-7} lines={lines15} />)
  console.log(lastFrame())
  console.log()
  unmount()
}

// --- Test 1b: Scrolled up by 3 (marginTop = -(15 - 8 - 3) = -4)
{
  console.log("Test 1b: 15 lines, viewport=8, scrolled up 3 (marginTop=-4)")
  console.log("Expect: Msg 05 through Msg 12")
  const { lastFrame, unmount } = render(<BasicScroll marginTop={-4} lines={lines15} />)
  console.log(lastFrame())
  console.log()
  unmount()
}

// --- Test 1c: Scrolled to top (marginTop=0)
{
  console.log("Test 1c: 15 lines, viewport=8, scrolled to top (marginTop=0)")
  console.log("Expect: Msg 01 through Msg 08")
  const { lastFrame, unmount } = render(<BasicScroll marginTop={0} lines={lines15} />)
  console.log(lastFrame())
  console.log()
  unmount()
}

// --- Test 1d: Content fits viewport (5 lines in 8-line viewport, no scroll needed)
{
  console.log("Test 1d: 5 lines, viewport=8, marginTop=0 (no scroll needed)")
  console.log("Expect: Short 01 through Short 05 + 3 blank lines")
  const { lastFrame, unmount } = render(<BasicScroll marginTop={0} lines={lines5} />)
  console.log(lastFrame())
  console.log()
  unmount()
}

// --- Test 2: measureElement reports the FULL content height
{
  console.log("Test 2: measureElement with 15 lines in 8-line viewport")
  measuredHeight = -1
  const { unmount } = render(<MeasureTest lines={lines15} />)
  // measureElement runs in useEffect, which fires after render
  console.log(`Measured height: ${measuredHeight} (expect 15)`)
  console.log(measuredHeight === 15 ? "PASS" : `FAIL — got ${measuredHeight}`)
  console.log()
  unmount()
}

// --- Test 2b: measureElement with content that fits
{
  console.log("Test 2b: measureElement with 5 lines in 8-line viewport")
  measuredHeight = -1
  const { unmount } = render(<MeasureTest lines={lines5} />)
  console.log(`Measured height: ${measuredHeight} (expect 5)`)
  console.log(measuredHeight === 5 ? "PASS" : `FAIL — got ${measuredHeight}`)
  console.log()
  unmount()
}

console.log("=== Done ===")
process.exit(0)
