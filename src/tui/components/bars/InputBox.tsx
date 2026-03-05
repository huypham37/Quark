// InputBox — input area with status info inside the box
//
// Uses Ink's native borderStyle="round" for reliable rendering at any
// terminal width. Status info (tokens, cost, model, skills) is shown
// as the first line inside the box.
//
// Layout (5 rows):
//   ╭──────────────────────────────────────────────────────────────────╮
//   │ 0% of 168k · $0.00 (free)                    coder── 0 skills  │
//   │ █                                                               │
//   │                                                                 │
//   ╰──────────────────────────────────────────────────────────────────╯

import React, { useState } from "react"
import { Box, Text, useInput, useStdin } from "ink"
import { colors } from "../../theme"

interface InputBoxProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
  // Status info (shown inside the box)
  tokensUsed?: number
  tokenLimit?: number
  cost?: number
  modelName?: string
  skillCount?: number
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%"
  return `${Math.round((used / limit) * 100)}%`
}

export function InputBox({
  onSubmit,
  disabled,
  placeholder,
  tokensUsed = 0,
  tokenLimit = 168000,
  cost = 0,
  modelName = "smart",
  skillCount = 0,
}: InputBoxProps) {
  const [value, setValue] = useState("")
  const { isRawModeSupported } = useStdin()

  useInput(
    (input, key) => {
      if (disabled) return

      if (key.return) {
        if (value.trim()) {
          onSubmit(value.trim())
          setValue("")
        }
        return
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1))
        return
      }

      // Ignore control keys
      if (key.ctrl || key.meta) return
      if (key.escape) return
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
      if (key.tab) return

      if (input) {
        setValue((v) => v + input)
      }
    },
    { isActive: isRawModeSupported && !disabled },
  )

  const borderColor = disabled ? colors.muted : "green"
  const leftStatus = `${formatPercent(tokensUsed, tokenLimit)} of ${formatTokens(tokenLimit)} · $${cost.toFixed(2)} (free)`
  const rightStatus = `${modelName}── ${skillCount} skill${skillCount !== 1 ? "s" : ""}`

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
