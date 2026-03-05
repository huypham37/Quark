// App — root TUI component
//
// Fullscreen layout: the app fills the entire terminal.
// Input/status/footer are pinned at the bottom.
// Message area fills the remaining space above.

import React, { useReducer, useCallback, useState, useEffect } from "react"
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink"
import { MessageList } from "./components/messages/MessageList"
import { InputBox } from "./components/bars/InputBox"
import { FooterBar } from "./components/bars/FooterBar"
import { PermissionPrompt } from "./components/bars/PermissionPrompt"
import { useEventBus } from "./hooks/useEventBus"
import { initialState, reduce } from "./state/state"
import { generateId } from "ai"
import { respond as respondPermission } from "../permission/permission"
import { colors } from "./theme"

interface AppProps {
  onSubmit: (text: string, sessionId: string | null) => void
  onCancel: (sessionId: string) => void
  initialSessionId?: string
  initialModelName?: string
  initialSkillCount?: number
}

export function App({ onSubmit, onCancel, initialSessionId, initialModelName, initialSkillCount }: AppProps) {
  const [state, dispatch] = useReducer(reduce, {
    ...initialState(),
    sessionId: initialSessionId ?? null,
    status: {
      ...initialState().status,
      modelName: initialModelName ?? "smart",
      skillCount: initialSkillCount ?? 0,
    },
  })
  const { exit } = useApp()
  const { isRawModeSupported } = useStdin()
  const { stdout } = useStdout()
  const [rows, setRows] = useState(stdout?.rows ?? 24)

  // Re-render on terminal resize
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows)
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  // Subscribe to backend events
  useEventBus(state.sessionId, dispatch)

  // Handle user input submission
  const handleSubmit = useCallback((text: string) => {
    // Clear any previous error on new submission
    if (state.lastError) {
      dispatch({ type: "clear-error" })
    }

    // Add user message to local state immediately
    const msgId = generateId()
    dispatch({ type: "add-user-message", id: msgId, text })

    // Notify the backend
    onSubmit(text, state.sessionId)
  }, [state.sessionId, state.lastError, onSubmit])

  // Handle Esc to cancel, and permission key responses
  useInput(
    (input, key) => {
      // Permission mode: intercept a/o/r keys
      if (state.permission) {
        const lower = input.toLowerCase()
        if (lower === "a") {
          respondPermission({ requestId: state.permission.requestId, reply: "always" })
          dispatch({ type: "clear-permission" })
          dispatch({ type: "set-running", running: true })
        } else if (lower === "o") {
          respondPermission({ requestId: state.permission.requestId, reply: "once" })
          dispatch({ type: "clear-permission" })
          dispatch({ type: "set-running", running: true })
        } else if (lower === "r") {
          respondPermission({ requestId: state.permission.requestId, reply: "reject" })
          dispatch({ type: "clear-permission" })
        }
        return
      }

      if (key.escape && state.running && state.sessionId) {
        onCancel(state.sessionId)
      }
      // Ctrl+C to exit
      if (input === "c" && key.ctrl) {
        if (state.running && state.sessionId) {
          onCancel(state.sessionId)
        }
        exit()
      }
    },
    { isActive: isRawModeSupported },
  )

  // Calculate bottom section height:
  // InputBox = 5 rows (status-top-border + 3 content rows + bottom border),
  // FooterBar = 1 row (always rendered, empty when idle).
  // Error and permission are transient — they shift the layout intentionally
  // to draw attention.
  let bottomHeight = 5 + 1 // input (with status in top border) + footer
  if (state.lastError) bottomHeight += 1
  if (state.permission) bottomHeight += 4

  const messagesHeight = Math.max(1, rows - bottomHeight)

  return (
    <Box flexDirection="column" height={rows} paddingX={2}>
      {/* Message area — fills remaining space, pinned to top */}
      <Box height={messagesHeight} flexDirection="column" overflow="hidden">
        <MessageList messages={state.messages} />
      </Box>

      {/* Error display */}
      {state.lastError && (
        <Box>
          <Text color={colors.error} bold>Error: </Text>
          <Text color={colors.error}>{state.lastError}</Text>
        </Box>
      )}

      {/* Permission prompt */}
      {state.permission && (
        <PermissionPrompt request={state.permission} />
      )}

      {/* Input box with status in top border */}
      <InputBox
        onSubmit={handleSubmit}
        disabled={state.running || !!state.permission}
        tokensUsed={state.status.tokensUsed}
        tokenLimit={state.status.tokenLimit}
        cost={state.status.cost}
        modelName={state.status.modelName}
        skillCount={state.status.skillCount}
      />

      {/* Footer bar (always rendered, empty when idle) */}
      <FooterBar running={state.running} />
    </Box>
  )
}
