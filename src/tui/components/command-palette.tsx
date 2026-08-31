// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { colors } from "../theme"
import type { PaletteEntry } from "../palette-index"
import type { SessionTreeRow } from "../session-tree-picker"
import { sessionControls, type SessionAction } from "../session-controls"
import type { ConnectProviderRow } from "../connect-provider"
import type { WorktreePickerRow } from "../worktree-picker"

const MAX_VISIBLE = 5
const MAX_VISIBLE_SESSIONS = 8

export type PaletteMode =
  | "search"
  | "sessions"
  | "skills"
  | "models"
  | "worktrees"
  | "worktree-create"
  | "connect-providers"
  | "connect-api-key"
  | "connect-codex-method"
  | "connect-authorizing"
  | "connect-result"

export interface ConnectPaletteView {
  providers: ConnectProviderRow[]
  providerName?: string
  environmentCredentialActive?: boolean
  apiKeyLength?: number
  codexMethod?: "browser" | "device"
  deviceCode?: { verificationUri: string; userCode: string }
  browserUrl?: string
  awaitingBrowserInput?: boolean
  result?: { kind: "success" | "info" | "error"; message: string }
}

export interface CommandPaletteProps {
  active: boolean
  query: string
  entries: PaletteEntry[]
  selectedIndex: number
  onInput: () => void
  onRef?: (ref: TextareaRenderable) => void
  mode?: PaletteMode
  sessionRows?: SessionTreeRow[]
  sessionAction?: SessionAction
  worktreeRows?: WorktreePickerRow[]
  worktreeError?: string
  connect?: ConnectPaletteView
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const dims = useTerminalDimensions()
  const sessionMode = () => props.mode === "sessions"
  const worktreeMode = () => props.mode === "worktrees"
  const worktreeCreateMode = () => props.mode === "worktree-create"
  const entityMode = () => props.mode === "skills" || props.mode === "models" || props.mode === "connect-providers"
  const connectMode = () => props.mode?.startsWith("connect-") && props.mode !== "connect-providers"
  const width = () => Math.min(60, Math.max(12, dims().width - 4))
  const maxVisibleSessions = () => Math.max(1, Math.min(MAX_VISIBLE_SESSIONS, dims().height - 8))
  // Reserve the app's six rows below the palette so a short terminal cannot
  // let the palette content overwrite the composer/footer area.
  const maxVisibleRows = () => Math.max(0, Math.min(MAX_VISIBLE, dims().height - 12))
  const visible = () => {
    const entries = props.entries
    const maximum = maxVisibleRows()
    if (maximum === 0) return []
    if (entries.length <= maximum) return entries
    const start = Math.min(Math.max(0, props.selectedIndex - maximum + 1), entries.length - maximum)
    return entries.slice(start, start + maximum)
  }
  const visibleStart = () => {
    const maximum = maxVisibleRows()
    return maximum === 0 || props.entries.length <= maximum ? 0 : Math.min(Math.max(0, props.selectedIndex - maximum + 1), props.entries.length - maximum)
  }
  const visibleSessions = () => {
    const rows = props.sessionRows ?? []
    const maximum = maxVisibleSessions()
    if (rows.length <= maximum) return rows
    const start = Math.min(Math.max(0, props.selectedIndex - maximum + 1), rows.length - maximum)
    return rows.slice(start, start + maximum)
  }
  const visibleSessionStart = () => {
    const rows = props.sessionRows ?? []
    const maximum = maxVisibleSessions()
    return rows.length <= maximum ? 0 : Math.min(Math.max(0, props.selectedIndex - maximum + 1), rows.length - maximum)
  }
  const visibleWorktrees = () => {
    const rows = props.worktreeRows ?? []
    const maximum = maxVisibleRows()
    if (maximum === 0) return []
    if (rows.length <= maximum) return rows
    const start = Math.min(Math.max(0, props.selectedIndex - maximum + 1), rows.length - maximum)
    return rows.slice(start, start + maximum)
  }
  const visibleWorktreeStart = () => {
    const rows = props.worktreeRows ?? []
    const maximum = maxVisibleRows()
    return maximum === 0 || rows.length <= maximum ? 0 : Math.min(Math.max(0, props.selectedIndex - maximum + 1), rows.length - maximum)
  }
  const hasQuery = () => entityMode() || worktreeMode() || Boolean(props.query.trim())
  const rows = () => worktreeMode()
    ? Math.max(1, visibleWorktrees().length)
    : hasQuery() && props.entries.length === 0 ? 1 : visible().length
  const sessionRowCount = () => Math.max(1, visibleSessions().length)
  const connectHeight = () => {
    // Every connect view has a title and divider, its content, a footer, and the
    // palette's two border rows. Keep this in the same sizing contract as the
    // standard palette modes so the footer stays inside the frame.
    if (props.mode === "connect-api-key") return 8
    if (props.mode === "connect-codex-method") return 7
    if (props.mode === "connect-authorizing") {
      return 6 + (props.connect?.browserUrl ? 1 : 0) + (props.connect?.deviceCode ? 2 : 0) + (props.connect?.awaitingBrowserInput ? 1 : 0)
    }
    return 6
  }
  // Section contract: title (1) + input (1) + divider (1) + footer (1) + 2 borders
  // = 6 fixed rows + content capacity. Keep the standard viewport fixed when
  // there is room, while shrinking it for short terminals.
  const spotlightMode = () => !props.mode || props.mode === "search"
  const standardContentRows = () => hasQuery() ? maxVisibleRows() : 0
  const footerVisible = () => !spotlightMode()
  const headerHeight = () => connectMode() ? 2 : spotlightMode() ? (hasQuery() ? 2 : 1) : 3
  const contentHeight = () => connectMode()
    ? connectHeight() - 5 // title, divider, footer, and two borders
    : sessionMode() ? sessionRowCount() : standardContentRows()
  const height = () => worktreeCreateMode()
    ? props.worktreeError ? 9 : 8
    : headerHeight() + contentHeight() + (footerVisible() ? 1 : 0) + 2
  const truncate = (value: string, maximum: number) => {
    const chars = Array.from(value)
    if (chars.length <= maximum) return value
    return maximum <= 1 ? "…" : `${chars.slice(0, maximum - 1).join("")}…`
  }
  const title = () => {
    if (connectMode()) return props.mode === "connect-result" ? (props.connect?.result?.message ?? "") : `Connect ${props.connect?.providerName ?? "provider"}`
    if (sessionMode()) return props.sessionAction === "rename" ? "Rename session" : "Sessions"
    if (worktreeMode()) return "Worktrees"
    if (props.mode === "models") return "Models"
    if (props.mode === "skills") return "Skills"
    if (props.mode === "connect-providers") return "Connect a provider"
    return "Command palette"
  }

  const footer = () => {
    if (props.mode === "connect-api-key") return "Enter connect · Esc back"
    if (props.mode === "connect-codex-method") return "↑↓ select · Enter continue · Esc back"
    if (props.mode === "connect-authorizing") return props.connect?.awaitingBrowserInput ? "Enter continue · Esc cancel" : "Esc cancel"
    if (props.mode === "connect-result") return "Enter close · Esc close"
    if (sessionMode()) return sessionControls(width(), props.sessionAction ?? "browse")
    // Compact key hints for narrow terminals; verbs stay descriptive when they fit.
    const compact = width() < 40
    if (worktreeMode()) return compact ? "↑↓ · Enter · Esc" : "↑↓ navigate · Enter switch · Esc close"
    if (props.mode === "skills") return compact ? "↑↓ · Enter · Esc" : "↑↓ navigate · Enter add · Esc close"
    if (props.mode === "models") return compact ? "↑↓ · Enter · Esc" : "↑↓ navigate · Enter switch · Esc close"
    if (props.mode === "connect-providers") return compact ? "↑↓ · Enter · Esc" : "↑↓ navigate · Enter connect · Esc close"
    return compact ? "↑↓ · Enter · Esc" : "↑↓ navigate · Enter select · Esc close"
  }

  return (
    <Show when={props.active}>
      <box position="absolute" left={Math.max(0, Math.floor((dims().width - width()) / 2))} top={Math.max(0, Math.floor((dims().height - 6 - height()) / 2))} width={width()} height={height()} flexDirection="column" borderStyle="rounded" borderColor={colors.outline} backgroundColor={colors.commandCardBg}>
        {/* Header */}
        <box height={headerHeight()} flexDirection="column" flexShrink={0} backgroundColor={colors.commandCardBg}>
          <Show when={!spotlightMode()}>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
              <text fg={colors.text} bg={colors.commandCardBg} bold>{title()}</text>
            </box>
          </Show>

          {/* Header: search/input bar (non-connect modes share the standard input) */}
          <Show when={!connectMode()}>
            <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text><textarea ref={(ref: TextareaRenderable) => props.onRef?.(ref)} focused height={1} flexGrow={1} value={props.query} placeholder={sessionMode() ? "Search sessions" : worktreeMode() ? "Search worktrees" : props.mode === "skills" ? "Search skills" : props.mode === "models" ? "Search models" : props.mode === "connect-providers" ? "Search providers" : "Search anything in Quark"} placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text} cursorColor={colors.cursorColor} cursorStyle={{ style: "block", blinking: true }} onContentChange={() => props.onInput()} /></box>
          </Show>

          <Show when={!spotlightMode() || hasQuery()}>
            <box height={1} backgroundColor={colors.commandCardBg}><text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text></box>
          </Show>
        </box>

        {/* Content */}
        <Show when={contentHeight() > 0}>
        <box height={contentHeight()} flexDirection="column" flexShrink={0} backgroundColor={colors.commandCardBg}>
        <Show when={connectMode()}>
          <Show when={props.mode === "connect-api-key"}>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>API key</text></box>
            <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}>
              <text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text>
              <text fg={colors.text} bg={colors.commandCardBg}>{"•".repeat(props.connect?.apiKeyLength ?? 0)}</text>
              <textarea ref={(ref: TextareaRenderable) => props.onRef?.(ref)} focused width={1} height={1} opacity={0} value={props.query} showCursor={false} textColor={colors.commandCardBg} focusedTextColor={colors.commandCardBg} backgroundColor={colors.commandCardBg} focusedBackgroundColor={colors.commandCardBg} onContentChange={() => props.onInput()} />
            </box>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>{props.connect?.environmentCredentialActive ? "Environment credential remains active after saving" : "Saved using Quark's configured credential store"}</text></box>
          </Show>
          <Show when={props.mode === "connect-codex-method"}>
            <For each={["Browser login", "Device code login"]}>{(method, index) => <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={index() === props.selectedIndex ? colors.primary : colors.text} bg={colors.commandCardBg} bold={index() === props.selectedIndex}>{index() === props.selectedIndex ? "❯ " : "  "}{method}</text></box>}</For>
          </Show>
          <Show when={props.mode === "connect-authorizing"}>
            <Show when={props.connect?.browserUrl}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.text} bg={colors.commandCardBg}>Open: {truncate(props.connect?.browserUrl ?? "", width() - 9)}</text></box></Show>
            <Show when={props.connect?.deviceCode}><box height={2} paddingX={1} flexDirection="column" backgroundColor={colors.commandCardBg}><text fg={colors.text} bg={colors.commandCardBg}>Open: {truncate(props.connect?.deviceCode?.verificationUri ?? "", width() - 9)}</text><text fg={colors.text} bg={colors.commandCardBg}>Enter code: {props.connect?.deviceCode?.userCode}</text></box></Show>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>{props.connect?.awaitingBrowserInput ? "Paste an authorization code or redirect URL (optional)" : "Waiting for authorization…"}</text></box>
            <Show when={props.connect?.awaitingBrowserInput}><box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text><textarea ref={(ref: TextareaRenderable) => props.onRef?.(ref)} focused height={1} flexGrow={1} value={props.query} textColor={colors.text} focusedTextColor={colors.text} cursorColor={colors.cursorColor} onContentChange={() => props.onInput()} /></box></Show>
          </Show>
          <Show when={props.mode === "connect-result"}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={props.connect?.result?.kind === "error" ? colors.error : props.connect?.result?.kind === "info" ? colors.info : colors.success} bg={colors.commandCardBg}>{props.connect?.result?.kind === "error" ? "Authentication was not completed" : props.connect?.result?.kind === "info" ? "Update the environment variable outside Quark" : "Authentication is ready"}</text></box></Show>
        </Show>
        <Show when={!connectMode()}>
          <Show when={worktreeCreateMode()}>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.text} bg={colors.commandCardBg} bold>Create worktree</text></box>
            <box height={1} backgroundColor={colors.commandCardBg}><text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text></box>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>Branch name</text></box>
            <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text><textarea ref={(ref: TextareaRenderable) => props.onRef?.(ref)} focused height={1} flexGrow={1} value={props.query} placeholder="feature/my-branch" placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text} cursorColor={colors.cursorColor} cursorStyle={{ style: "block", blinking: true }} onContentChange={() => props.onInput()} /></box>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>Starts from current HEAD</text></box>
            <Show when={props.worktreeError}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.error} bg={colors.commandCardBg}>✕ {truncate(props.worktreeError ?? "", width() - 6)}</text></box></Show>
            <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>Enter create · Esc back</text></box>
          </Show>
          <Show when={!worktreeCreateMode()}>
          <Show when={!sessionMode() && !worktreeMode() && props.query.trim() && props.entries.length === 0}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>No results</text></box></Show>
          <Show when={sessionMode() && (props.sessionRows?.length ?? 0) === 0}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>No sessions found</text></box></Show>
          <Show when={worktreeMode() && (props.worktreeRows?.length ?? 0) === 0}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>No worktrees found</text></box></Show>
          <Show when={sessionMode()}><For each={visibleSessions()}>{(row, index) => {
            if (row.type === "spacer") return <box height={1} backgroundColor={colors.commandCardBg} />
            const selected = () => visibleSessionStart() + index() === props.selectedIndex
            const tree = row.type === "orphan" || row.connector === "plain" || row.connector === "root" ? "" : `${row.guides.map((guide) => guide ? "│  " : "   ").join("")}${row.connector === "last" ? "└─" : "├─"} `
            return <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={selected() ? colors.primary : row.running ? colors.success : colors.text} bg={colors.commandCardBg} bold={selected()}>{selected() ? "❯ " : "  "}{tree}{truncate(row.label, Math.max(3, width() - row.detail.length - 8))}</text><box flexGrow={1} backgroundColor={colors.commandCardBg} /><text fg={colors.muted} bg={colors.commandCardBg}>{truncate(row.detail, Math.floor(width() * 0.4))}</text></box>
          }}</For></Show>
          <Show when={worktreeMode()}><For each={visibleWorktrees()}>{(row, index) => {
            const selected = () => visibleWorktreeStart() + index() === props.selectedIndex && (row.type === "create" || row.type === "worktree")
            const marker = () => row.type === "worktree" ? row.current ? " ← current" : row.root ? " (root)" : "" : ""
            return <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={row.type === "disabled" ? colors.muted : selected() ? colors.primary : colors.text} bg={colors.commandCardBg} bold={selected()}>{selected() ? "❯ " : "  "}{truncate(row.label, Math.max(3, width() - marker().length - 6))}{marker()}</text></box>
          }}</For></Show>
          <Show when={!sessionMode() && !worktreeMode()}><For each={visible()}>{(entry, index) => {
            const selected = () => visibleStart() + index() === props.selectedIndex
            const type = () => entry.type === "provider" ? "Provider" : entry.type[0]!.toUpperCase() + entry.type.slice(1)
            const state = () => entry.isCurrent ? " · current" : entry.isUnavailable ? " · unavailable" : ""
            const available = () => Math.max(4, width() - 16)
            const suffix = () => truncate((entry.detail ?? "") + state(), Math.floor(available() * 0.45))
            const label = () => truncate(entry.label, Math.max(3, available() - suffix().length - 1))
            return <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={selected() ? colors.primary : colors.muted} bg={colors.commandCardBg} bold={selected()}>{selected() ? "❯ " : "  "}{type().padEnd(9)}</text><text fg={selected() ? colors.primary : colors.text} bg={colors.commandCardBg} bold={selected()}>{label()}</text><box flexGrow={1} backgroundColor={colors.commandCardBg} /><text fg={colors.muted} bg={colors.commandCardBg}>{suffix()}</text></box>
          }}</For></Show>
        </Show>
        </box>
        </Show>

        <Show when={footerVisible()}>
          {/* Footer */}
          <box height={1} paddingX={1} flexShrink={0} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>{truncate(footer(), Math.max(0, width() - 4))}</text></box>
        </Show>
        </Show>
      </box>
    </Show>
  )
}
