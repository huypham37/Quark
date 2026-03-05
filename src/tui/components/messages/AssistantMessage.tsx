// AssistantMessage — renders assistant text with inline markdown
//
// Shows the assistant's response text. Handles streaming (partial text)
// and completed text.

import React from "react"
import { Box } from "ink"
import { MarkdownBlock } from "../primitives/Markdown"

interface AssistantMessageProps {
  text: string
  streaming?: boolean
}

export function AssistantMessage({ text, streaming }: AssistantMessageProps) {
  if (!text) return null

  return (
    <Box flexDirection="column">
      <MarkdownBlock text={text} />
    </Box>
  )
}
