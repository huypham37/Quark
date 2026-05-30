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
import type { SessionTreeRow } from "../session-tree-picker"
import { CommandCard } from "./command-card"

/** Maximum visible rows in the dropdown */
const MAX_VISIBLE_ROWS = 5
const MAX_SESSION_VISIBLE_ROWS = 8
const SESSION_CARD_INSET = 2

export interface PickerItem {
  id: string
  label: string
  detail: string
  isCurrent?: boolean
}

export type AutocompleteMode =
  | { type: "files"; items: string[]; selectedIndex: number; query: string }
  | { type: "commands"; items: SlashCommand[]; selectedIndex: number; query: string }
  | { type: "sessions"; rows: SessionTreeRow[]; selectedIndex: number }
  | { type: "models"; items: PickerItem[]; selectedIndex: number }
  | { type: "profiles"; items: PickerItem[]; selectedIndex: number }

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
  bg: ColorInput
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
  const maxVisibleRows = () => {
    const isSession = m()?.type === "sessions"
    const borderRows = isSession ? 2 : 0
    const available = Math.max(1, dims().height - BOTTOM_OFFSET - borderRows)
    return Math.min(isSession ? MAX_SESSION_VISIBLE_ROWS : MAX_VISIBLE_ROWS, available)
  }

  // Scroll to keep selected item visible
  createEffect(() => {
    const mode = m()
    if (!mode || !scrollRef) return
    const selectedIndex = mode.selectedIndex
    const viewportHeight = maxVisibleRows()
    const rowIndex = scrollAnchorIndex(mode, selectedIndex, viewportHeight)
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

    // Optional title row (sessions / choice pickers)
    if (mode.type === "sessions") {
      // The sessions picker is a task tree; task headers are rendered below.
    } else if (mode.type === "models") {
      result.push({ label: "Models — select and press Enter to switch", fg: colors.primary, bg: colors.dropdownBg, bold: true })
    } else if (mode.type === "profiles") {
      result.push({ label: "Profiles — select and press Enter to switch", fg: colors.primary, bg: colors.dropdownBg, bold: true })
    }

    // Empty-state row OR data rows (mutually exclusive)
    if (mode.type === "files" && mode.items.length === 0) {
      result.push({ label: `No files or directories matching @${mode.query}`, fg: colors.muted, bg: colors.dropdownBg, bold: false })
    } else if (mode.type === "commands" && mode.items.length === 0) {
      result.push({ label: `No commands matching /${mode.query}`, fg: colors.muted, bg: colors.dropdownBg, bold: false })
    } else if (mode.type === "sessions" && mode.rows.length === 0) {
      result.push({ label: "No sessions found", fg: colors.muted, bg: colors.commandCardBg, bold: false })
    } else if (mode.type === "models" && mode.items.length === 0) {
      result.push({ label: "No models available", fg: colors.muted, bg: colors.dropdownBg, bold: false })
    } else if (mode.type === "profiles" && mode.items.length === 0) {
      result.push({ label: "No profiles available", fg: colors.muted, bg: colors.dropdownBg, bold: false })
    } else if (mode.type === "commands") {
      for (let i = 0; i < mode.items.length; i++) {
        const cmd = mode.items[i]!
        const sel = i === mode.selectedIndex
        const prefix = sel ? "❯" : " "
        const usage = cmd.usage ? ` ${cmd.usage}` : ""
        result.push({
          label: `${prefix} /${cmd.id}${usage} — ${cmd.description}`,
          fg: sel ? colors.primary : colors.textDim,
          bg: colors.dropdownBg,
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
          bg: colors.dropdownBg,
          bold: sel,
        })
      }
    } else if (mode.type === "sessions") {
      for (let i = 0; i < mode.rows.length; i++) {
        const item = mode.rows[i]!
        if (item.type === "spacer") {
          result.push({ label: "", fg: colors.textDim, bg: colors.commandCardBg, bold: false })
          continue
        }

        const sel = i === mode.selectedIndex && (item.type === "session" || item.type === "orphan")
        const indent = item.type === "session" ? `${"   ".repeat(item.depth)}╰─▶ ` : ""
        const prefix = item.type === "task" ? (item.current ? "› " : "  ") : "  "
        result.push({
          label: item.type === "task"
            ? `${prefix}${item.label}`
            : item.type === "orphan"
              ? `  ${item.label}`
              : `  ${indent}${item.label}`,
          fg: sel ? colors.primary : item.type === "task" ? (item.current ? colors.primary : colors.text) : colors.textDim,
          bg: colors.commandCardBg,
          bold: sel,
        })
      }
    } else if (mode.type === "models" || mode.type === "profiles") {
      for (let i = 0; i < mode.items.length; i++) {
        const item = mode.items[i]!
        const sel = i === mode.selectedIndex
        result.push({
          label: `${sel ? "❯ " : "  "}${item.label}${item.isCurrent ? "  ← current" : ""}`,
          fg: sel ? colors.primary : colors.textDim,
          bg: colors.dropdownBg,
          bold: sel,
        })
      }
    }

    return result
  }

  // Compute visible height: min of actual rows and MAX_VISIBLE_ROWS
  const visibleHeight = () => Math.min(rows().length, maxVisibleRows())
  const isSessionCard = () => m()?.type === "sessions"
  const panelBg = () => isSessionCard() ? colors.commandCardBg : colors.dropdownBg
  const panelHeight = () => isSessionCard() && rows().length > 0 ? visibleHeight() + 2 : visibleHeight()

  const content = () => (
    <scrollbox
      ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
      height={visibleHeight()}
      scrollbarOptions={{ visible: false }}
      bg={panelBg()}
    >
      <For each={rows()}>
        {(row) => {
          // Pad label with spaces to fill the full row width so bg covers all cells.
          // Keep the row background inside the picker shell, not under its border.
          const padded = () => {
            const w = dims().width - (isSessionCard() ? 10 : 6)
            return row.label.length >= w ? row.label : row.label + " ".repeat(w - row.label.length)
          }
          return (
            <box height={1} bg={row.bg}>
              <text fg={row.fg} bg={row.bg} bold={row.bold}>{padded()}</text>
            </box>
          )
        }}
      </For>
    </scrollbox>
  )

  return (
    <box
      flexDirection="column"
      paddingX={1}
      height={panelHeight()}
      position="absolute"
      bottom={BOTTOM_OFFSET}
      left={isSessionCard() ? SESSION_CARD_INSET : 0}
      right={isSessionCard() ? SESSION_CARD_INSET : 0}
      bg={rows().length > 0 && !isSessionCard() ? colors.dropdownBg : undefined}
    >
      {isSessionCard() && rows().length > 0
        ? <CommandCard height={panelHeight()}>{content()}</CommandCard>
        : content()}
    </box>
  )
}

function scrollAnchorIndex(mode: AutocompleteMode, selectedIndex: number, viewportHeight: number): number {
  if (mode.type === "models" || mode.type === "profiles") return selectedIndex + 1
  if (mode.type !== "sessions") return selectedIndex

  for (let i = selectedIndex - 1; i >= 0; i--) {
    const row = mode.rows[i]
    if (!row || row.type === "spacer") break
    if (row.type === "task") {
      return selectedIndex - i < viewportHeight ? i : selectedIndex
    }
  }

  return selectedIndex
}
