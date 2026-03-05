// MessageList — renders all messages in the conversation
//
// Renders all messages as normal Box components so they participate
// in flexbox layout (needed for fullscreen pinned-bottom input).
// No <Static> — it renders above the viewport and breaks layout.
//
// Uses justifyContent="flex-end" so that when messages exceed the
// visible area, the most recent messages are shown (auto-scroll to bottom).

import React from "react"
import { Box } from "ink"
import { MessageItem } from "./MessageItem"
import type { TuiMessage } from "../../state/state"

interface MessageListProps {
  messages: TuiMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
      {messages.map((msg) => (
        <Box key={msg.id} flexDirection="column">
          <MessageItem message={msg} />
        </Box>
      ))}
    </Box>
  )
}
