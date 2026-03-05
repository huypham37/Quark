// TreeLine — renders tree-style connectors for tool invocation blocks
//
// Matches Amp's style:
//   · Oracle
//   └── description text here
//       that can wrap multiple lines

import React, { type ReactNode } from "react"
import { Box, Text } from "ink"
import { icons, colors } from "../../theme"

interface TreeLineProps {
  label: string
  labelColor?: string
  children: ReactNode
}

export function TreeLine({ label, labelColor, children }: TreeLineProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.muted}>{icons.dot} </Text>
        <Text bold color={labelColor}>{label}</Text>
      </Box>
      <Box>
        <Text color={colors.muted}>{icons.treeCorner} </Text>
        <Box flexDirection="column" flexShrink={1}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
