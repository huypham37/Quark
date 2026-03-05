// TUI visual demo — renders mock data to verify the layout looks like Amp
//
// Fullscreen layout: fills entire terminal, input pinned at bottom.
// Arrow Up/Down to scroll, q to quit.
// Usage: bun scripts/tui-demo.tsx
//        bun scripts/tui-demo.tsx --static   (non-interactive, exits after 300ms)

import React, { useState, useEffect } from "react"
import { render, Box, useStdout, useInput, useStdin, useApp } from "ink"
import { MessageList } from "../src/tui/components/messages/MessageList"
import { InputBox } from "../src/tui/components/bars/InputBox"
import { FooterBar } from "../src/tui/components/bars/FooterBar"
import type { TuiMessage } from "../src/tui/state/state"

const isStatic = process.argv.includes("--static")

// Mock messages that look like the Amp screenshot — enough to overflow a terminal
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
    parts: [{ type: "text", text: "Let's explore the Atom project in 02-Experiment" }],
  },
  {
    id: "msg-3",
    role: "assistant",
    parts: [
      { type: "thinking", done: true },
      { type: "tool", tool: "read", callId: "c4", status: "completed", input: { filePath: "src/provider/provider.ts" }, output: "..." },
      { type: "tool", tool: "read", callId: "c5", status: "completed", input: { filePath: "src/session/prompt.ts" }, output: "..." },
      { type: "tool", tool: "bash", callId: "c6", status: "completed", input: { command: "wc -l src/**/*.ts" }, output: "..." },
      {
        type: "text",
        text: `The **Atom** project is a minimal coding agent built from scratch. Here's the architecture:

### Provider Layer
- \`copilot-auth.ts\` — OAuth device flow for GitHub Copilot authentication
- \`copilot-fetch.ts\` — Fetch wrapper that injects required Copilot headers
- \`provider.ts\` — Creates the AI SDK provider with model routing (GPT-5+ uses Responses API)

### Session Management
- \`session.ts\` — CRUD operations for chat sessions (SQLite via Drizzle ORM)
- \`message.ts\` — Message persistence with model message conversion
- \`processor.ts\` — Streams AI responses and emits events via the event bus
- \`prompt.ts\` — The main agent loop with tool execution

### Tools
Six core tools: \`read\`, \`write\`, \`edit\`, \`bash\`, \`skill\`, \`todo\`

### TUI (Ink + React)
Full terminal interface matching Amp's layout: scrollable message area, input box, footer bar.

Total: ~3,200 lines of TypeScript across 28 source files.`,
      },
    ],
  },
  {
    id: "msg-4",
    role: "user",
    parts: [{ type: "text", text: "Can you show me how the scrolling works?" }],
  },
  {
    id: "msg-5",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `The scrolling system uses a technique validated through spike testing:

1. **ScrollableBox component** wraps content in a fixed-height \`<Box>\` with \`overflow="hidden"\`
2. Inner content has \`flexShrink={0}\` to prevent Yoga from compressing it
3. A negative \`marginTop\` shifts content upward, and the overflow clip hides the shifted portion
4. \`measureElement\` tracks the real content height for scroll offset calculations

The scroll offset is expressed as "lines from bottom" — 0 means pinned to the latest message, positive values scroll upward.

Arrow keys in the App component adjust the scroll offset by 3 lines per press. Auto-scroll snaps to bottom when new messages arrive or during streaming.`,
      },
    ],
  },
  {
    id: "msg-6",
    role: "assistant",
    streaming: true,
    parts: [
      { type: "thinking", done: true },
      {
        type: "tool",
        tool: "skill",
        callId: "c7",
        status: "running",
        input: {
          name: "Oracle",
          description: "Analyze the ScrollableBox implementation for edge cases and potential improvements.",
        },
      },
    ],
  },
]

function Demo() {
  const { stdout } = useStdout()
  const { isRawModeSupported } = useStdin()
  const { exit } = useApp()
  const [rows, setRows] = useState(stdout?.rows ?? 24)
  const [scrollOffset, setScrollOffset] = useState(0)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows)
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  useInput(
    (input, key) => {
      if (input === "q" || (input === "c" && key.ctrl)) {
        exit()
      }
      if (key.upArrow) {
        setScrollOffset((prev) => prev + 3)
      }
      if (key.downArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 3))
      }
    },
    { isActive: isRawModeSupported && !isStatic },
  )

  const bottomHeight = 5 + 1
  const messagesHeight = Math.max(1, rows - bottomHeight)

  return (
    <Box flexDirection="column" height={rows} paddingX={2}>
      <MessageList messages={mockMessages} height={messagesHeight} scrollOffset={scrollOffset} />

      <InputBox
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={true}
        tokensUsed={16800}
        tokenLimit={168000}
        cost={0.56}
        modelName="smart"
        skillCount={1}
      />

      <FooterBar running={true} />
    </Box>
  )
}

const { unmount } = render(<Demo />)

if (isStatic) {
  setTimeout(() => {
    unmount()
    process.exit(0)
  }, 300)
}
