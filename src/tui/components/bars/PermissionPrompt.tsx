// PermissionPrompt — renders when a tool needs user approval
//
// Shows the tool name + input, and key hints: (a) Always, (o) Once, (r) Reject

import React from "react"
import { Box, Text } from "ink"
import { colors, icons } from "../../theme"
import type { PermissionRequest } from "../../state/state"

interface PermissionPromptProps {
  request: PermissionRequest
}

export function PermissionPrompt({ request }: PermissionPromptProps) {
  // Compact representation of the input
  const inputStr = JSON.stringify(request.input, null, 2)
  const shortInput = inputStr.length > 200 ? inputStr.slice(0, 200) + "..." : inputStr

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.warning}>{icons.dot} </Text>
        <Text bold>Allow </Text>
        <Text color={colors.primary}>{request.tool}</Text>
        <Text>?</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={colors.muted}>{shortInput}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.footerKey} bold>(a)</Text>
        <Text> Always  </Text>
        <Text color={colors.footerKey} bold>(o)</Text>
        <Text> Once  </Text>
        <Text color={colors.error} bold>(r)</Text>
        <Text> Reject</Text>
      </Box>
    </Box>
  )
}
