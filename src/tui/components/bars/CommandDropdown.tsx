// CommandDropdown — autocomplete dropdown for / slash commands and picker items
//
// Two modes:
//   "commands" — renders matching slash commands (default)
//   "sessions" — renders session picker items (after selecting /sessions)
//
// Highlights the currently selected item. Controlled entirely by App.

import React from "react"
import { Box, Text } from "ink"
import { colors } from "../../theme"
import type { SlashCommand } from "../../commands"

export interface PickerItem {
  id: string
  label: string
  detail: string
  isCurrent?: boolean
}

export interface CommandDropdownProps {
  mode: "commands" | "sessions"
  items: SlashCommand[]
  pickerItems: PickerItem[]
  selectedIndex: number
  query: string
}

export function CommandDropdown({ mode, items, pickerItems, selectedIndex, query }: CommandDropdownProps) {
  if (mode === "sessions") {
    return <SessionPicker items={pickerItems} selectedIndex={selectedIndex} />
  }

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

// ---------------------------------------------------------------------------
// Session picker sub-component
// ---------------------------------------------------------------------------

function SessionPicker({ items, selectedIndex }: { items: PickerItem[]; selectedIndex: number }) {
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={colors.muted}>No sessions found</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={colors.primary} bold>Sessions</Text>
        <Text color={colors.muted}> — select and press Enter to switch</Text>
      </Box>
      {items.map((item, i) => {
        const isSelected = i === selectedIndex
        return (
          <Box key={item.id} paddingX={1} gap={1}>
            <Text
              color={isSelected ? colors.primary : colors.textDim}
              bold={isSelected}
            >
              {isSelected ? "❯" : " "}
            </Text>
            <Text color={isSelected ? colors.text : colors.textDim} bold={isSelected}>
              {item.label}
            </Text>
            <Text color={colors.muted}>{item.detail}</Text>
            {item.isCurrent && (
              <Text color={colors.success}> ← current</Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
