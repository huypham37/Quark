// MessageList — renders all messages, auto-scrolls to bottom on new content
//
// Uses Ink's <Static> for completed messages and regular render for
// the latest streaming message. This prevents re-rendering the entire
// history on each text delta.

import React from "react"
import { Box, Static } from "ink"
import { MessageItem } from "./MessageItem"
import type { TuiMessage } from "../../state/state"

interface MessageListProps {
  messages: TuiMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  // Split into completed messages (Static) and the active streaming message
  const completed: TuiMessage[] = []
  let active: TuiMessage | undefined

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.streaming) {
      active = msg
    } else {
      completed.push(msg)
    }
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Completed messages — rendered once, never re-rendered */}
      <Static items={completed}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column">
            <MessageItem message={msg} />
          </Box>
        )}
      </Static>

      {/* Active streaming message — re-renders on each delta */}
      {active && (
        <Box flexDirection="column">
          <MessageItem message={active} />
        </Box>
      )}
    </Box>
  )
}
