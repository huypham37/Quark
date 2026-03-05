// UserMessage — renders user input with a cyan left border bar
//
// Matches Amp's style:
//   │ use oracle

import React from "react"
import { Box, Text } from "ink"
import { colors } from "../../theme"

interface UserMessageProps {
  text: string
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <Box>
      <Text color={colors.userBar}>│ </Text>
      <Text italic>{text}</Text>
    </Box>
  )
}
