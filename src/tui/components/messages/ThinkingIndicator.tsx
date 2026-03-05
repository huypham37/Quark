// ThinkingIndicator — shows collapsed/expanded thinking block
//
// Matches Amp's style:
//   ✓ Thinking ▶  (collapsed)

import React from "react"
import { Box, Text } from "ink"
import { Checkmark } from "../primitives/Icon"
import { colors, icons } from "../../theme"

interface ThinkingIndicatorProps {
  done?: boolean
}

export function ThinkingIndicator({ done }: ThinkingIndicatorProps) {
  return (
    <Box>
      {done ? (
        <Checkmark />
      ) : (
        <Text color={colors.muted}>…</Text>
      )}
      <Text> Thinking </Text>
      <Text color={colors.muted}>{icons.arrow}</Text>
    </Box>
  )
}
