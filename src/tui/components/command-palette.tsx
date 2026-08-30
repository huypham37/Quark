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

const MAX_VISIBLE = 5
const MAX_VISIBLE_SESSIONS = 8

export type PaletteMode =
  | "search"
  | "sessions"
  | "skills"
  | "models"
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
  connect?: ConnectPaletteView
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const dims = useTerminalDimensions()
  const sessionMode = () => props.mode === "sessions"
  const entityMode = () => props.mode === "skills" || props.mode === "models" || props.mode === "connect-providers"
  const connectMode = () => props.mode?.startsWith("connect-") && props.mode !== "connect-providers"
  const width = () => Math.min(60, Math.max(12, dims().width - 4))
  const maxVisibleSessions = () => Math.max(1, Math.min(MAX_VISIBLE_SESSIONS, dims().height - 8))
  const visible = () => {
    const entries = props.entries
    if (entries.length <= MAX_VISIBLE) return entries
    const start = Math.min(Math.max(0, props.selectedIndex - MAX_VISIBLE + 1), entries.length - MAX_VISIBLE)
    return entries.slice(start, start + MAX_VISIBLE)
  }
  const visibleStart = () => props.entries.length <= MAX_VISIBLE ? 0 : Math.min(Math.max(0, props.selectedIndex - MAX_VISIBLE + 1), props.entries.length - MAX_VISIBLE)
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
  const hasQuery = () => entityMode() || Boolean(props.query.trim())
  const rows = () => hasQuery() && props.entries.length === 0 ? 1 : visible().length
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
  const height = () => connectMode() ? connectHeight() : sessionMode() ? sessionRowCount() + 6 : hasQuery() ? 4 + MAX_VISIBLE + (entityMode() ? 1 : 0) : 3
  const truncate = (value: string, maximum: number) => {
    const chars = Array.from(value)
    if (chars.length <= maximum) return value
    return maximum <= 1 ? "…" : `${chars.slice(0, maximum - 1).join("")}…`
  }
  const footer = () => props.mode === "connect-api-key"
      ? "Enter connect · Esc back"
      : props.mode === "connect-codex-method"
        ? "↑↓ select · Enter continue · Esc back"
        : props.mode === "connect-authorizing" ? "Esc cancel" : "Enter close · Esc close"

  return (
    <Show when={props.active}>
      <box position="absolute" left={Math.max(0, Math.floor((dims().width - width()) / 2))} top={Math.max(0, Math.floor((dims().height - 6 - height()) / 2))} width={width()} height={height()} flexDirection="column" borderStyle="rounded" borderColor={colors.outline} backgroundColor={colors.commandCardBg}>
        <Show when={connectMode()}>
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}>
            <text fg={colors.text} bg={colors.commandCardBg} bold>
              {props.mode === "connect-result" ? props.connect?.result?.message : `Connect ${props.connect?.providerName ?? "provider"}`}
            </text>
          </box>
          <box height={1} backgroundColor={colors.commandCardBg}><text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text></box>
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
          <box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>{footer()}</text></box>
        </Show>

        <Show when={!connectMode()}>
          <Show when={sessionMode() || entityMode()}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.text} bg={colors.commandCardBg} bold>{sessionMode() ? props.sessionAction === "rename" ? "Rename session" : "Sessions" : props.mode === "models" ? "Models" : props.mode === "connect-providers" ? "Connect a provider" : "Skills"}</text></box></Show>
          <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={colors.primary} bg={colors.commandCardBg}>{"> "}</text><textarea ref={(ref: TextareaRenderable) => props.onRef?.(ref)} focused height={1} flexGrow={1} value={props.query} placeholder={sessionMode() ? "Search sessions" : props.mode === "skills" ? "Search skills" : props.mode === "models" ? "Search models" : props.mode === "connect-providers" ? "Search providers" : "Search anything in Quark"} placeholderColor={colors.muted} textColor={colors.text} focusedTextColor={colors.text} cursorColor={colors.cursorColor} cursorStyle={{ style: "block", blinking: true }} onContentChange={() => props.onInput()} /></box>
          <Show when={sessionMode() || rows() > 0}><box height={1} backgroundColor={colors.commandCardBg}><text fg={colors.outline} bg={colors.commandCardBg}>{"─".repeat(Math.max(0, width() - 2))}</text></box></Show>
          <Show when={!sessionMode() && props.query.trim() && props.entries.length === 0}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>No results</text></box></Show>
          <Show when={sessionMode() && (props.sessionRows?.length ?? 0) === 0}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>No sessions found</text></box></Show>
          <Show when={sessionMode()}><For each={visibleSessions()}>{(row, index) => {
            if (row.type === "spacer") return <box height={1} backgroundColor={colors.commandCardBg} />
            const selected = () => visibleSessionStart() + index() === props.selectedIndex
            const tree = row.type === "orphan" || row.connector === "plain" || row.connector === "root" ? "" : `${row.guides.map((guide) => guide ? "│  " : "   ").join("")}${row.connector === "last" ? "└─" : "├─"} `
            return <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={selected() ? colors.primary : row.running ? colors.success : colors.text} bg={colors.commandCardBg} bold={selected()}>{selected() ? "❯ " : "  "}{tree}{truncate(row.label, Math.max(3, width() - row.detail.length - 8))}</text><box flexGrow={1} backgroundColor={colors.commandCardBg} /><text fg={colors.muted} bg={colors.commandCardBg}>{truncate(row.detail, Math.floor(width() * 0.4))}</text></box>
          }}</For></Show>
          <Show when={!sessionMode()}><For each={visible()}>{(entry, index) => {
            const selected = () => visibleStart() + index() === props.selectedIndex
            const type = () => entry.type === "provider" ? "Provider" : entry.type[0]!.toUpperCase() + entry.type.slice(1)
            const state = () => entry.isCurrent ? " · current" : entry.isUnavailable ? " · unavailable" : ""
            const available = () => Math.max(4, width() - 16)
            const suffix = () => truncate((entry.detail ?? "") + state(), Math.floor(available() * 0.45))
            const label = () => truncate(entry.label, Math.max(3, available() - suffix().length - 1))
            return <box height={1} paddingX={1} flexDirection="row" backgroundColor={colors.commandCardBg}><text fg={selected() ? colors.primary : colors.muted} bg={colors.commandCardBg} bold={selected()}>{selected() ? "❯ " : "  "}{type().padEnd(9)}</text><text fg={selected() ? colors.primary : colors.text} bg={colors.commandCardBg} bold={selected()}>{label()}</text><box flexGrow={1} backgroundColor={colors.commandCardBg} /><text fg={colors.muted} bg={colors.commandCardBg}>{suffix()}</text></box>
          }}</For></Show>
          <Show when={sessionMode()}><box height={1} paddingX={1} backgroundColor={colors.commandCardBg}><text fg={colors.muted} bg={colors.commandCardBg}>{sessionControls(width(), props.sessionAction ?? "browse")}</text></box></Show>
        </Show>
      </box>
    </Show>
  )
}
