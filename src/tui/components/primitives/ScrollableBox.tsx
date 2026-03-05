// ScrollableBox — a viewport that clips content and scrolls via offset
//
// Ink has no built-in scrollable container. This component works by:
// 1. Rendering all children inside a flexbox column with flexShrink=0
//    (without flexShrink=0, Yoga compresses content to fit the parent)
// 2. Applying a negative marginTop to shift content upward
// 3. The parent Box with overflow="hidden" clips the shifted content
//
// The scroll offset is in "lines" from the bottom (0 = pinned to bottom).
// The component measures total content height using Ink's measureElement.
//
// Validated via scripts/scroll-spike.tsx spike test.

import React, { useRef, useEffect, useState } from "react"
import { Box, measureElement } from "ink"

interface ScrollableBoxProps {
  height: number
  scrollOffset: number // lines from bottom (0 = bottom, positive = scrolled up)
  children: React.ReactNode
  width?: string | number
}

export function ScrollableBox({ height, scrollOffset, children, width = "100%" }: ScrollableBoxProps) {
  const innerRef = useRef(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (innerRef.current) {
      const { height: measured } = measureElement(innerRef.current)
      if (measured !== contentHeight) {
        setContentHeight(measured)
      }
    }
  })

  // How far from the top we need to shift.
  // When scrollOffset=0 (bottom), we shift so the last `height` lines are visible.
  // marginTop = -(contentHeight - height - scrollOffset)
  // Clamped so we never scroll past the top or bottom.
  const maxScroll = Math.max(0, contentHeight - height)
  const clampedOffset = Math.min(scrollOffset, maxScroll)
  const marginTop = -Math.max(0, maxScroll - clampedOffset)

  return (
    <Box height={height} flexDirection="column" overflow="hidden" width={width}>
      <Box
        ref={innerRef}
        flexDirection="column"
        flexShrink={0}
        width="100%"
        marginTop={marginTop}
      >
        {children}
      </Box>
    </Box>
  )
}
