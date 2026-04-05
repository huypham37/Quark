// @jsxImportSource @opentui/solid
// Autocomplete — dropdown for @ file mentions, / slash commands, and pickers
//
// Renders above the Prompt component. Controlled entirely by App.tsx.
// Replaces both FileDropdown and CommandDropdown from the React TUI.

import type { Component } from "solid-js"
import { For, createEffect } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { colors } from "../theme"
import type { SlashCommand } from "../commands"

/** Maximum visible rows in the dropdown */
const MAX_VISIBLE_ROWS = 5

export interface PickerItem {
  id: string
  label: string
  detail: string
  isCurrent?: boolean
}

export type AutocompleteMode =
  | { type: "files"; items: string[]; selectedIndex: number; query: string }
  | { type: "commands"; items: SlashCommand[]; selectedIndex: number; query: string }
  | { type: "sessions"; items: PickerItem[]; selectedIndex: number }
  | { type: "models"; items: PickerItem[]; selectedIndex: number }

export interface AutocompleteProps {
  mode: AutocompleteMode | null
}

// Height of Prompt (status line 1 + input box minHeight 4) + FooterBar (1)
// Used to anchor the absolutely-positioned dropdown above the prompt.
const BOTTOM_OFFSET = 6

export const Autocomplete: Component<AutocompleteProps> = (props) => {
  // Absolutely positioned overlay — does NOT participate in flex flow,
  // so the scrollbox keeps its full height when the dropdown appears.
  // Anchored to bottom={BOTTOM_OFFSET} to sit right above the prompt.
  //
  // When mode is null, rows() returns [] and height={0}, rendering nothing.

  return <AutocompleteContent mode={props.mode} />
}

/** Row type for the unified list — title, empty text, and data rows all in one array */
interface DropdownRow {
  label: string
  fg: ColorInput
  bold: boolean
}

/**
 * Renders the dropdown content — single <For>, ZERO <Show> blocks.
 *
 * Title text, empty-state text, and selectable items are all folded into
 * one computed `rows()` array. This avoids multiple LayoutSlotRenderables
 * (created by <Show>) which cause Yoga height miscalculation and row overlap.
 *
 * Uses scrollbox when items exceed MAX_VISIBLE_ROWS to enable scrolling.
 */
const AutocompleteContent: Component<{ mode: AutocompleteMode | null }> = (props) => {
  const dims = useTerminalDimensions()
  const m = () => props.mode
  let scrollRef: ScrollBoxRenderable | undefined

  // Scroll to keep selected item visible
  createEffect(() => {
    const mode = m()
    if (!mode || !scrollRef) return
    const selectedIndex = mode.selectedIndex
    // Account for title row in sessions/models pickers
    const hasTitle = mode.type === "sessions" || mode.type === "models"
    const rowIndex = hasTitle ? selectedIndex + 1 : selectedIndex

    const viewportHeight = MAX_VISIBLE_ROWS
    const scrollBottom = scrollRef.scrollTop + viewportHeight
    if (rowIndex < scrollRef.scrollTop) {
      scrollRef.scrollTo(rowIndex)
    } else if (rowIndex + 1 > scrollBottom) {
      scrollRef.scrollTo(rowIndex + 1 - viewportHeight)
    }
  })

  const rows = (): DropdownRow[] => {
    const mode = m()
    if (!mode) return []
    const result: DropdownRow[] = []

    // Optional title row (sessions / models)
    if (mode.type === "sessions") {
      result.push({ label: "Sessions — select and press Enter to switch", fg: colors.primary, bold: true })
    } else if (mode.type === "models") {
      result.push({ label: "Models — select and press Enter to switch", fg: colors.primary, bold: true })
    }

    // Empty-state row OR data rows (mutually exclusive)
    if (mode.type === "files" && mode.items.length === 0) {
      result.push({ label: `No files or directories matching @${mode.query}`, fg: colors.muted, bold: false })
    } else if (mode.type === "commands" && mode.items.length === 0) {
      result.push({ label: `No commands matching /${mode.query}`, fg: colors.muted, bold: false })
    } else if (mode.type === "sessions" && mode.items.length === 0) {
      result.push({ label: "No sessions found", fg: colors.muted, bold: false })
    } else if (mode.type === "models" && mode.items.length === 0) {
      result.push({ label: "No models available", fg: colors.muted, bold: false })
    } else if (mode.type === "commands") {
      for (let i = 0; i < mode.items.length; i++) {
        const cmd = mode.items[i]!
        const sel = i === mode.selectedIndex
        const prefix = sel ? "❯" : " "
        const usage = cmd.usage ? ` ${cmd.usage}` : ""
        result.push({
          label: `${prefix} /${cmd.id}${usage} — ${cmd.description}`,
          fg: sel ? colors.primary : colors.textDim,
          bold: sel,
        })
      }
    } else if (mode.type === "files") {
      for (let i = 0; i < mode.items.length; i++) {
        const item = mode.items[i]!
        const sel = i === mode.selectedIndex
        result.push({
          label: `${sel ? "❯ " : "  "}${item}`,
          fg: sel ? colors.primary : colors.textDim,
          bold: sel,
        })
      }
    } else if (mode.type === "sessions") {
      for (let i = 0; i < mode.items.length; i++) {
        const item = mode.items[i]!
        const sel = i === mode.selectedIndex
        result.push({
          label: `${sel ? "❯ " : "  "}${item.label}${item.isCurrent ? "  ← current" : ""}`,
          fg: sel ? colors.primary : colors.textDim,
          bold: sel,
        })
      }
    } else if (mode.type === "models") {
      for (let i = 0; i < mode.items.length; i++) {
        const item = mode.items[i]!
        const sel = i === mode.selectedIndex
        result.push({
          label: `${sel ? "❯ " : "  "}${item.label}${item.isCurrent ? "  ← current" : ""}`,
          fg: sel ? colors.primary : colors.textDim,
          bold: sel,
        })
      }
    }

    return result
  }

  // Compute visible height: min of actual rows and MAX_VISIBLE_ROWS
  const visibleHeight = () => Math.min(rows().length, MAX_VISIBLE_ROWS)

  return (
    <box
      flexDirection="column"
      paddingX={1}
      height={visibleHeight()}
      position="absolute"
      bottom={BOTTOM_OFFSET}
      left={0}
      right={0}
      bg={rows().length > 0 ? colors.dropdownBg : undefined}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
        height={visibleHeight()}
        scrollbarOptions={{ visible: false }}
        bg={colors.dropdownBg}
      >
        <For each={rows()}>
          {(row) => {
            // Pad label with spaces to fill the full row width so bg covers all cells.
            // Outer box has paddingX={2} (App) + paddingX={1} (this box) = 6 cols used.
            const padded = () => {
              const w = dims().width - 6
              return row.label.length >= w ? row.label : row.label + " ".repeat(w - row.label.length)
            }
            return (
              <box height={1} bg={colors.dropdownBg}>
                <text fg={row.fg} bg={colors.dropdownBg} bold={row.bold}>{padded()}</text>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}
