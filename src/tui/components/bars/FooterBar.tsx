// FooterBar — bottom bar showing running status and cancel hint
//
// Matches Amp's style:
//   ⇄ Running tools...         Esc to cancel

import React from "react"
import { Box, Text, useStdout } from "ink"
import { colors, icons } from "../../theme"

interface FooterBarProps {
  running: boolean
  onCancel?: () => void
}

export function FooterBar({ running }: FooterBarProps) {
  if (!running) return null

  return (
    <Box justifyContent="space-between" width="100%">
      <Box>
        <Text color={colors.primary}>{icons.spinner} </Text>
        <Text>Running tools...</Text>
      </Box>
      <Box>
        <Text color={colors.footerKey} bold>Esc</Text>
        <Text> to cancel</Text>
      </Box>
    </Box>
  )
}
