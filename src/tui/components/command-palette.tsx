// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { colors } from "../theme"
import type { PaletteEntry } from "../palette-index"

const MAX_VISIBLE = 5

export interface CommandPaletteProps {
  active: boolean
  query: string
  entries: PaletteEntry[]
  selectedIndex: number
  onInput: () => void
  onRef?: (ref: TextareaRenderable) => void
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const dims = useTerminalDimensions()
  const width = () => Math.min(60, Math.max(12, dims().width - 4))
  const visible = () => {
    const entries = props.entries
    if (entries.length <= MAX_VISIBLE) return entries
    const start = Math.min(
      Math.max(0, props.selectedIndex - MAX_VISIBLE + 1),
      entries.length - MAX_VISIBLE,
    )
    return entries.slice(start, start + MAX_VISIBLE)
  }
  const visibleStart = () => props.entries.length <= MAX_VISIBLE
    ? 0
    : Math.min(Math.max(0, props.selectedIndex - MAX_VISIBLE + 1), props.entries.length - MAX_VISIBLE)
  const hasQuery = () => Boolean(props.query.trim())
  const rows = () => hasQuery() && props.entries.length === 0 ? 1 : visible().length
  const height = () => hasQuery() ? 4 + MAX_VISIBLE : 3
  const truncate = (value: string, maximum: number) => {
    const chars = Array.from(value)
    if (chars.length <= maximum) return value
    return maximum <= 1 ? "…" : `${chars.slice(0, maximum - 1).join("")}…`
  }

  return (
    <Show when={props.active}>
      <box
        position="absolute"
        left={Math.max(0, Math.floor((dims().width - width()) / 2))}
        top={Math.max(0, Math.floor((dims().height - 6 - height()) / 2))}
        width={width()}
        height={height()}
        flexDirection="column"
        borderStyle="rounded"
        borderColor={colors.outline}
        backgroundColor={colors.commandCardBg}
      >
        <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}>
          <text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text>
          <textarea
            ref={(ref: TextareaRenderable) => props.onRef?.(ref)}
            focused
            height={1}
            flexGrow={1}
            value={props.query}
            placeholder="Search anything in Quark"
            placeholderColor={colors.muted}
            textColor={colors.text}
            focusedTextColor={colors.text}
            cursorColor={colors.cursorColor}
            cursorStyle={{ style: "block", blinking: true }}
            onContentChange={() => props.onInput()}
          />
        </box>
        <Show when={rows() > 0}>
          <box height={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text>
          </box>
        </Show>
        <Show when={props.query.trim() && props.entries.length === 0}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.muted} bg={colors.commandCardBg}>No results</text>
          </box>
        </Show>
        <For each={visible()}>
          {(entry, index) => {
            const selected = () => visibleStart() + index() === props.selectedIndex
            const type = () => entry.type[0]!.toUpperCase() + entry.type.slice(1)
            const state = () => entry.isCurrent ? " · current" : entry.isUnavailable ? " · unavailable" : ""
            const available = () => Math.max(4, width() - 16)
            const suffix = () => truncate((entry.detail ?? "") + state(), Math.floor(available() * 0.45))
            const label = () => truncate(entry.label, Math.max(3, available() - suffix().length - 1))
            return (
              <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}>
                <text fg={selected() ? colors.primary : colors.muted} bg={colors.commandCardBg} bold={selected()}>
                  {selected() ? "❯ " : "  "}{type().padEnd(9)}
                </text>
                <text fg={selected() ? colors.primary : colors.text} bg={colors.commandCardBg} bold={selected()}>
                  {label()}
                </text>
                <box flexGrow={1} backgroundColor={colors.commandCardBg} />
                <text fg={colors.muted} bg={colors.commandCardBg}>
                  {suffix()}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
