// InputBox — controlled input area with status info inside the box
//
// Uses Ink's native borderStyle="round" for reliable rendering at any
// terminal width. Status info (tokens, cost, model, skills) is shown
// as the first line inside the box.
//
// This is a CONTROLLED component: App owns the value state and passes
// value/onChange/onSubmit as props. This enables @ mention handling at
// the App level.
//
// When `mentionActive` is true, Enter/Tab/arrows are forwarded to
// onKeyPress only (for dropdown navigation) and NOT processed locally.
//
// Layout (5 rows):
//   ╭──────────────────────────────────────────────────────────────────╮
//   │ 0% of 168k · $0.00 (free)                    coder── 0 skills  │
//   │ █                                                               │
//   │                                                                 │
//   ╰──────────────────────────────────────────────────────────────────╯

import React from "react"
import { Box, Text, useInput, useStdin } from "ink"
import { colors } from "../../theme"

export interface InputBoxProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  onKeyPress?: (input: string, key: InputKey) => void
  mentionActive?: boolean
  disabled?: boolean
  placeholder?: string
  // Status info (shown inside the box)
  tokensUsed?: number
  tokenLimit?: number
  cost?: number
  modelName?: string
  skillCount?: number
}

export interface InputKey {
  return: boolean
  backspace: boolean
  delete: boolean
  escape: boolean
  ctrl: boolean
  meta: boolean
  tab: boolean
  upArrow: boolean
  downArrow: boolean
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%"
  return `${Math.round((used / limit) * 100)}%`
}

// SGR mouse sequences arrive with leading ESC stripped by Ink, e.g. "[<64;90;20M".
// We must reject them so they don't get typed into the input field.
const SGR_MOUSE_INPUT_RE = /\[<\d+;\d+;\d+[Mm]/

export function InputBox({
  value,
  onChange,
  onSubmit,
  onKeyPress,
  mentionActive,
  disabled,
  placeholder,
  tokensUsed = 0,
  tokenLimit = 168000,
  cost = 0,
  modelName = "smart",
  skillCount = 0,
}: InputBoxProps) {
  const { isRawModeSupported } = useStdin()

  useInput(
    (input, key) => {
      if (disabled) return

      // Drop SGR mouse escape sequences — they're handled by useMouseScroll
      if (SGR_MOUSE_INPUT_RE.test(input)) return

      // Forward key press to parent for @ mention handling
      if (onKeyPress) {
        onKeyPress(input, key as InputKey)
      }

      // When mention dropdown is active, Enter/Tab/arrows are consumed
      // by the parent's onKeyPress handler — don't process them here.
      if (mentionActive) {
        if (key.return || key.tab || key.upArrow || key.downArrow || key.escape) {
          return
        }
      }

      if (key.return) {
        if (value.trim()) {
          onSubmit(value.trim())
        }
        return
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1))
        return
      }

      // Ignore control keys
      if (key.ctrl || key.meta) return
      if (key.escape) return
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
      if (key.tab) return

      if (input) {
        onChange(value + input)
      }
    },
    { isActive: isRawModeSupported && !disabled },
  )

  const borderColor = disabled ? colors.muted : "green"
  const leftStatus = `${formatPercent(tokensUsed, tokenLimit)} of ${formatTokens(tokenLimit)} · $${cost.toFixed(2)} (free)`

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width="100%"
      height={5}
    >
      {/* Status line */}
      <Box justifyContent="space-between" width="100%">
        <Text color={colors.statusLine}>{leftStatus}</Text>
        <Box>
          <Text color={colors.statusModel}>{modelName}</Text>
          <Text color={colors.statusLine}>── </Text>
          <Text color={colors.statusSkills}>{skillCount} skill{skillCount !== 1 ? "s" : ""}</Text>
        </Box>
      </Box>

      {/* Input line */}
      <Box>
        <Text>
          {value || (
            <Text dimColor>{placeholder ?? ""}</Text>
          )}
          {!disabled && <Text color={colors.primary}>█</Text>}
        </Text>
      </Box>
    </Box>
  )
}
