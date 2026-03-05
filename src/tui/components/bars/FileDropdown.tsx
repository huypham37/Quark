// FileDropdown — autocomplete dropdown for @ file mentions
//
// Renders above the InputBox showing fuzzy-filtered file matches.
// Highlights the currently selected item. Controlled entirely by App.

import React from "react"
import { Box, Text } from "ink"
import { colors } from "../../theme"

export interface FileDropdownProps {
  items: string[]
  selectedIndex: number
  query: string // the current @ query text (for display)
}

export function FileDropdown({ items, selectedIndex, query }: FileDropdownProps) {
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={colors.muted}>No files matching </Text>
        <Text color={colors.primary}>@{query}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {items.map((file, i) => {
        const isSelected = i === selectedIndex
        return (
          <Box key={file} paddingX={1}>
            <Text
              color={isSelected ? colors.primary : colors.textDim}
              bold={isSelected}
            >
              {isSelected ? "❯ " : "  "}
              {file}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
