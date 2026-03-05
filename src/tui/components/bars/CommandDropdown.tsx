// CommandDropdown — autocomplete dropdown for / slash commands
//
// Renders above the InputBox showing matching commands.
// Highlights the currently selected item. Controlled entirely by App.

import React from "react"
import { Box, Text } from "ink"
import { colors } from "../../theme"
import type { SlashCommand } from "../../commands"

export interface CommandDropdownProps {
  items: SlashCommand[]
  selectedIndex: number
  query: string
}

export function CommandDropdown({ items, selectedIndex, query }: CommandDropdownProps) {
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={colors.muted}>No commands matching </Text>
        <Text color={colors.primary}>/{query}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {items.map((cmd, i) => {
        const isSelected = i === selectedIndex
        return (
          <Box key={cmd.id} paddingX={1} gap={1}>
            <Text
              color={isSelected ? colors.primary : colors.textDim}
              bold={isSelected}
            >
              {isSelected ? "❯" : " "}
              /{cmd.id}
            </Text>
            {cmd.usage && (
              <Text color={colors.muted}>{cmd.usage}</Text>
            )}
            <Text color={colors.muted}>— {cmd.description}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
