// MessageItem — renders a single message (user or assistant) with all its parts
//
// Dispatches to the appropriate sub-component based on part type:
// - text → AssistantMessage (or UserMessage for user role)
// - tool → ToolResultLine (completed/error) or ToolInvocationBlock (running)
// - thinking → ThinkingIndicator

import React from "react"
import { Box } from "ink"
import { UserMessage } from "./UserMessage"
import { AssistantMessage } from "./AssistantMessage"
import { ToolResultLine } from "./ToolResultLine"
import { ToolInvocationBlock } from "./ToolInvocationBlock"
import { ThinkingIndicator } from "./ThinkingIndicator"
import type { TuiMessage, TuiPart } from "../../state/state"

interface MessageItemProps {
  message: TuiMessage
}

// Extract a description for tool invocation display
function getToolDescription(tool: string, input: Record<string, unknown>): string {
  // For multi-line tools like bash, show the command
  if (tool === "bash") {
    const cmd = input.command ?? input.cmd
    if (typeof cmd === "string") return cmd
  }

  // For skill tool, show the description
  if (tool === "skill") {
    const desc = input.description
    if (typeof desc === "string") return desc
  }

  // For read/write/edit, the ToolResultLine handles display
  return JSON.stringify(input, null, 2)
}

function renderPart(part: TuiPart, index: number, isStreaming: boolean) {
  switch (part.type) {
    case "text":
      return (
        <Box key={`text-${index}`} marginBottom={part.streaming ? 0 : 1}>
          <AssistantMessage text={part.text} streaming={part.streaming} />
        </Box>
      )

    case "tool":
      if (part.status === "running" || part.status === "pending") {
        // Show invocation block for running tools (like Oracle, Bash)
        if (part.tool === "skill" || part.tool === "bash") {
          return (
            <Box key={`tool-${part.callId}`} marginBottom={1}>
              <ToolInvocationBlock
                tool={part.tool}
                description={getToolDescription(part.tool, part.input)}
              />
            </Box>
          )
        }
        // For simple tools (read/write/edit), show a pending line
        return (
          <Box key={`tool-${part.callId}`}>
            <ToolResultLine
              tool={part.tool}
              input={part.input}
              status={part.status}
            />
          </Box>
        )
      }

      // Completed or errored tool
      return (
        <Box key={`tool-${part.callId}`}>
          <ToolResultLine
            tool={part.tool}
            input={part.input}
            status={part.status}
            output={part.output}
            error={part.error}
          />
        </Box>
      )

    case "thinking":
      return (
        <Box key={`thinking-${index}`} marginBottom={1}>
          <ThinkingIndicator done={part.done} />
        </Box>
      )

    default:
      return null
  }
}

export function MessageItem({ message }: MessageItemProps) {
  if (message.role === "user") {
    // User messages have a single text part
    const textPart = message.parts.find((p) => p.type === "text")
    if (!textPart || textPart.type !== "text") return null

    return (
      <Box marginBottom={1}>
        <UserMessage text={textPart.text} />
      </Box>
    )
  }

  // Assistant message — render all parts
  return (
    <Box flexDirection="column">
      {message.parts.map((part, i) =>
        renderPart(part, i, !!message.streaming),
      )}
    </Box>
  )
}
