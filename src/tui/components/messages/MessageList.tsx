// MessageList — renders all messages in a scrollable viewport
//
// Uses ScrollableBox for offset-based scrolling. The scroll offset
// is controlled by the parent (App) via arrow keys.
// When scrollOffset=0, the view is pinned to the bottom (latest messages).

import React from "react"
import { Box } from "ink"
import { ScrollableBox } from "../primitives/ScrollableBox"
import { MessageItem } from "./MessageItem"
import type { TuiMessage } from "../../state/state"

interface MessageListProps {
  messages: TuiMessage[]
  height: number
  scrollOffset: number
}

export function MessageList({ messages, height, scrollOffset }: MessageListProps) {
  return (
    <ScrollableBox height={height} scrollOffset={scrollOffset}>
      {messages.map((msg) => (
        <Box key={msg.id} flexDirection="column" width="100%">
          <MessageItem message={msg} />
        </Box>
      ))}
    </ScrollableBox>
  )
}
