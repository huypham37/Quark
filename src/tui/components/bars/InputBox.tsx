// InputBox — bordered text input area at the bottom
//
// Matches Amp's style: a simple bordered box with cursor, no prompt char.

import React, { useState } from "react"
import { Box, Text, useInput, useStdin } from "ink"
import { colors } from "../../theme"

interface InputBoxProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function InputBox({ onSubmit, disabled, placeholder }: InputBoxProps) {
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

  return (
    <Box
      borderStyle="single"
      borderColor={disabled ? colors.muted : colors.border}
      paddingX={1}
      width="100%"
      height={3}
    >
      <Text>
        {value || (
          <Text dimColor>{placeholder ?? ""}</Text>
        )}
        {!disabled && <Text color={colors.primary}>█</Text>}
      </Text>
    </Box>
  )
}
