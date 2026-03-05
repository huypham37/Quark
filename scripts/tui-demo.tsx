// TUI visual demo — renders mock data to verify the layout looks like Amp
//
// Fullscreen layout: fills entire terminal, input pinned at bottom.
// Usage: bun scripts/tui-demo.tsx

import React, { useState, useEffect } from "react"
import { render, Box, useStdout } from "ink"
import { MessageList } from "../src/tui/components/messages/MessageList"
import { StatusBar } from "../src/tui/components/bars/StatusBar"
import { FooterBar } from "../src/tui/components/bars/FooterBar"
import type { TuiMessage } from "../src/tui/state/state"

// Mock messages that look like the Amp screenshot
const mockMessages: TuiMessage[] = [
  {
    id: "tool-1",
    role: "assistant",
    parts: [
      { type: "tool", tool: "read", callId: "c1", status: "completed", input: { filePath: "01-CodeSpace/Personal-Lab" }, output: "..." },
      { type: "tool", tool: "read", callId: "c2", status: "completed", input: { filePath: "package.json" }, output: "..." },
      { type: "tool", tool: "read", callId: "c3", status: "completed", input: { filePath: "01-CodeSpace/Work" }, output: "..." },
    ],
  },
  {
    id: "msg-1",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `Your workspace (/Users/mac) is your home directory. Here's what I found:

**01-CodeSpace/** — Your main code workspace, split into:

- **Personal-Lab/** — Personal projects: 01-Working_Project, 02-Experiment, 03-Learning, 04-github-repo, a GitHub Pages site (huypham37.github.io), and Utils
- **Work/** — Work projects: 04-PMI, pmi-gpt, pmi-gpt-25, report

Other notable directories: 02-UM/, dotfiles/, searxng/, Steve/, tmp/

Which project would you like me to dive into?`,
      },
    ],
  },
  {
    id: "msg-2",
    role: "user",
    parts: [{ type: "text", text: "use oracle" }],
  },
  {
    id: "msg-3",
    role: "assistant",
    streaming: true,
    parts: [
      { type: "thinking", done: true },
      {
        type: "tool",
        tool: "skill",
        callId: "c4",
        status: "running",
        input: {
          name: "Oracle",
          description: "Explore and analyze the codebase structure under /Users/mac/01-CodeSpace/ to understand the overall architecture, key projects, tech stacks used, and how the projects relate to each other.",
        },
      },
    ],
  },
]

function Demo() {
  const { stdout } = useStdout()
  const [rows, setRows] = useState(stdout?.rows ?? 24)

  // Handle terminal resize
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows)
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  // Bottom section: StatusBar(1) + InputBox placeholder(3) + FooterBar(1) = 5
  const bottomHeight = 1 + 3 + 1
  const messagesHeight = Math.max(1, rows - bottomHeight)

  return (
    <Box flexDirection="column" height={rows}>
      {/* Message area — fills remaining space */}
      <Box height={messagesHeight} flexDirection="column" overflow="hidden">
        <MessageList messages={mockMessages} />
      </Box>

      {/* Status bar */}
      <StatusBar
        tokensUsed={16800}
        tokenLimit={168000}
        cost={0.56}
        modelName="smart"
        skillCount={1}
      />

      {/* Input box placeholder */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        width="100%"
      >
        {/* Empty input box */}
      </Box>

      {/* Footer bar */}
      <FooterBar running={true} />
    </Box>
  )
}

const { unmount } = render(<Demo />)
setTimeout(() => {
  unmount()
  process.exit(0)
}, 300)
