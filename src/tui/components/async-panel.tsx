// @jsxImportSource @opentui/solid
// AsyncPanel — side overlay for parallel ephemeral sessions (/async-msg)
//
// Interactive panel: user types into the panel's own textarea input.
// The panel is opened empty; the session is created lazily on first submit.
//
// ┌─ msg ────────────────┐
// │                      │
// │  You: fix auth       │
// │  ● Working…          │
// │  The fix is…         │
// │                      │
// │──────────────────────│
// │  > type here _       │
// └──────────────────────┘

import type { Component } from "solid-js"
import { Show, For, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"
import { InlineSpinner } from "./inline-spinner"
import type { AsyncPanel as AsyncPanelState, TuiMessage, TuiPart } from "../state"

interface AsyncPanelProps {
  panel: AsyncPanelState
  onClose: () => void
  onToggleCollapse: () => void
  onSubmit: (text: string) => void
}

const PANEL_WIDTH = 40
const PANEL_BG = RGBA.fromHex("#1a1d21")
const PANEL_BORDER = RGBA.fromHex("#3d4147")

const CondensedMessage: Component<{ message: TuiMessage }> = (props) => {
  const textPart = () => {
    const part = props.message.parts.find((p): p is Extract<TuiPart, { type: "text" }> => p.type === "text")
    return part?.text ?? ""
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      <Show when={props.message.role === "user"}>
        <text fg={colors.primary} bold>You:</text>
      </Show>
      <text fg={colors.text} wrap="wrap">{textPart()}</text>
    </box>
  )
}

export const AsyncPanel: Component<AsyncPanelProps> = (props) => {
  const dims = useTerminalDimensions()

  let scrollRef: ScrollBoxRenderable | undefined
  let textareaRef: TextareaRenderable | undefined

  const panelTop = () => 1
  const panelLeft = () => Math.max(0, dims().width - PANEL_WIDTH - 1)
  const contentHeight = () => Math.max(3, Math.min(18, dims().height - 12))

  const handleSubmit = () => {
    if (!textareaRef) return
    const raw = textareaRef.plainText.trim()
    if (!raw) return
    textareaRef.clear()
    props.onSubmit(raw)
  }

  const workingLabel = () => {
    if (props.panel.done) {
      return props.panel.toolsUsed > 0
        ? `✓ ${props.panel.toolsUsed} tools used`
        : "✓ Done"
    }
    if (props.panel.running) {
      return props.panel.toolsUsed > 0
        ? `● Working… (${props.panel.toolsUsed} tools)`
        : "● Working…"
    }
    return ""
  }

  const hasContent = () => props.panel.messages.length > 0 || !!workingLabel()

  return (
    <box
      position="absolute"
      top={panelTop()}
      left={panelLeft()}
      width={PANEL_WIDTH}
      height={props.panel.collapsed ? 3 : contentHeight() + 5}
      flexDirection="column"
      borderStyle="round"
      borderColor={PANEL_BORDER}
      backgroundColor={PANEL_BG}
      zIndex={500}
    >
      {/* Title bar */}
      <box flexDirection="row" paddingX={1} height={1} backgroundColor={PANEL_BG}>
        <text fg={colors.primary} bg={PANEL_BG} bold>
          {props.panel.title.slice(0, PANEL_WIDTH - 8)}
        </text>
        <box flexGrow={1} backgroundColor={PANEL_BG} />
        <Show when={props.panel.unread > 0}>
          <text fg={colors.error} bg={PANEL_BG}>●</text>
        </Show>
        <Show when={props.panel.running}>
          <InlineSpinner />
        </Show>
        <text
          fg={colors.textDim}
          bg={PANEL_BG}
          onMouseUp={() => props.onToggleCollapse()}
        >
          {props.panel.collapsed ? " [+]" : " [-]"}
        </text>
      </box>

      {/* Expanded content */}
      <Show when={!props.panel.collapsed}>
        {/* Separator */}
        <text fg={PANEL_BORDER} bg={PANEL_BG}>{"─".repeat(PANEL_WIDTH - 4)}</text>

        {/* Messages */}
        <scrollbox
          ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
          flexGrow={1}
          flexBasis={0}
          minHeight={0}
          overflow="hidden"
          paddingX={1}
          backgroundColor={PANEL_BG}
          scrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" backgroundColor={PANEL_BG}>
            <Show when={hasContent()} fallback={<box height={1} />}>
              <For each={props.panel.messages}>
                {(msg) => <CondensedMessage message={msg} />}
              </For>
              <Show when={workingLabel()}>
                <text fg={colors.muted}>{workingLabel()}</text>
              </Show>
            </Show>
          </box>
        </scrollbox>

        {/* Separator above input */}
        <text fg={PANEL_BORDER} bg={PANEL_BG}>{"─".repeat(PANEL_WIDTH - 4)}</text>

        {/* Mini input */}
        <box flexDirection="row" paddingX={1} height={1} backgroundColor={PANEL_BG}>
          <text fg={colors.primary} bg={PANEL_BG}>{"> "}</text>
          <textarea
            ref={(r: TextareaRenderable) => { textareaRef = r }}
            focused={true}
            placeholder=""
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.textDim}
            cursorColor={colors.cursorColor}
            cursorStyle={{ style: "line", blinking: true }}
            onSubmit={handleSubmit}
            maxHeight={1}
            backgroundColor={PANEL_BG}
            keyBindings={[
              { name: "return", action: "submit" },
            ]}
          />
        </box>
      </Show>
    </box>
  )
}
