// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { colors } from "../theme"
import type { PaletteEntry } from "../palette-index"
import type { SessionTreeRow } from "../session-tree-picker"
import { sessionControls, type SessionAction } from "../session-controls"

const MAX_VISIBLE = 5
const MAX_VISIBLE_SESSIONS = 8

export interface CommandPaletteProps {
  active: boolean
  query: string
  entries: PaletteEntry[]
  selectedIndex: number
  onInput: () => void
  onRef?: (ref: TextareaRenderable) => void
  mode?: "search" | "sessions"
  sessionRows?: SessionTreeRow[]
  sessionAction?: SessionAction
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const dims = useTerminalDimensions()
  const sessionMode = () => props.mode === "sessions"
  const width = () => Math.min(60, Math.max(12, dims().width - 4))
  const maxVisibleSessions = () => Math.max(1, Math.min(MAX_VISIBLE_SESSIONS, dims().height - 8))
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
  const visibleSessions = () => {
    const rows = props.sessionRows ?? []
    const maximum = maxVisibleSessions()
    if (rows.length <= maximum) return rows
    const start = Math.min(
      Math.max(0, props.selectedIndex - maximum + 1),
      rows.length - maximum,
    )
    return rows.slice(start, start + maximum)
  }
  const visibleSessionStart = () => {
    const rows = props.sessionRows ?? []
    const maximum = maxVisibleSessions()
    return rows.length <= maximum
      ? 0
      : Math.min(Math.max(0, props.selectedIndex - maximum + 1), rows.length - maximum)
  }
  const hasQuery = () => Boolean(props.query.trim())
  const rows = () => hasQuery() && props.entries.length === 0 ? 1 : visible().length
  const sessionRowCount = () => Math.max(1, visibleSessions().length)
  const height = () => sessionMode() ? sessionRowCount() + 6 : hasQuery() ? 4 + MAX_VISIBLE : 3
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
        <Show when={sessionMode()}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.text} bg={colors.commandCardBg} bold>
              {props.sessionAction === "rename" ? "Rename session" : "Sessions"}
            </text>
          </box>
        </Show>
        <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}>
          <text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text>
          <textarea
            ref={(ref: TextareaRenderable) => props.onRef?.(ref)}
            focused
            height={1}
            flexGrow={1}
            value={props.query}
            placeholder={sessionMode() ? "Search sessions" : "Search anything in Quark"}
            placeholderColor={colors.muted}
            textColor={colors.text}
            focusedTextColor={colors.text}
            cursorColor={colors.cursorColor}
            cursorStyle={{ style: "block", blinking: true }}
            onContentChange={() => props.onInput()}
          />
        </box>
        <Show when={sessionMode() || rows() > 0}>
          <box height={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text>
          </box>
        </Show>
        <Show when={!sessionMode() && props.query.trim() && props.entries.length === 0}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.muted} bg={colors.commandCardBg}>No results</text>
          </box>
        </Show>
        <Show when={sessionMode() && (props.sessionRows?.length ?? 0) === 0}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.muted} bg={colors.commandCardBg}>No sessions found</text>
          </box>
        </Show>
        <Show when={sessionMode()}>
          <For each={visibleSessions()}>
            {(row, index) => {
              if (row.type === "spacer") {
                return <box height={1} backgroundColor={colors.commandCardBg} />
              }
              const selected = () => visibleSessionStart() + index() === props.selectedIndex
              const tree = row.type === "orphan" || row.connector === "plain" || row.connector === "root"
                ? ""
                : `${row.guides.map((guide) => guide ? "│  " : "   ").join("")}${row.connector === "last" ? "└─" : "├─"} `
              return (
                <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}>
                  <text fg={selected() ? colors.primary : row.running ? colors.success : colors.text} bg={colors.commandCardBg} bold={selected()}>
                    {selected() ? "❯ " : "  "}{tree}{truncate(row.label, Math.max(3, width() - row.detail.length - 8))}
                  </text>
                  <box flexGrow={1} backgroundColor={colors.commandCardBg} />
                  <text fg={colors.muted} bg={colors.commandCardBg}>{truncate(row.detail, Math.floor(width() * 0.4))}</text>
                </box>
              )
            }}
          </For>
        </Show>
        <Show when={!sessionMode()}>
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
        </Show>
        <Show when={sessionMode()}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.muted} bg={colors.commandCardBg}>
              {sessionControls(width(), props.sessionAction ?? "browse")}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
