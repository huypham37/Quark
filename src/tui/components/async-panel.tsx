// @jsxImportSource @opentui/solid
// AsyncPanel — side overlay for parallel ephemeral sessions (/async-msg)
//
// Visual style:
//   • single-line border, rounded corners
//   • title on the top border line (via <box title>)
//   • solid background matching the terminal background color
//   • "You:" / "Assistant:" labels on messages
//   • footer hint below the input

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { colors, terminalBg } from "../theme"
import type { AsyncPanel as AsyncPanelState, TuiMessage, TuiPart } from "../state"

interface AsyncPanelProps {
  panel: AsyncPanelState
  onClose: () => void
  onSubmit: (text: string) => void
}

const PANEL_WIDTH = 40
const PANEL_BORDER = RGBA.fromHex("#3d4147")

// Panel background uses the detected terminal background color so the overlay
// blends with the terminal while remaining opaque (no see-through holes).
const PANEL_BG = () => terminalBg

const CondensedMessage: Component<{ message: TuiMessage }> = (props) => {
  // Collect ALL text parts — the model may emit text → tool → text in one turn.
  const allText = () => {
    const texts: string[] = []
    for (const p of props.message.parts) {
      if (p.type === "text" && p.text) texts.push(p.text)
    }
    return texts.join("\n")
  }

  // Hide assistant messages that have no visible text (e.g. reasoning-only
  // or tool-call-only turns). The "● Working…" indicator is shown separately.
  const isVisible = () =>
    props.message.role === "user" || allText().trim().length > 0

  return (
    <Show when={isVisible()}>
      <box flexDirection="column" marginBottom={1} backgroundColor={PANEL_BG()}>
        <Show when={props.message.role === "user"}>
          <text fg={colors.primary} bg={PANEL_BG()} bold>You:</text>
        </Show>
        <Show when={props.message.role === "assistant"}>
          <text fg={colors.primary} bg={PANEL_BG()} bold>Assistant:</text>
        </Show>
        <text fg={colors.text} bg={PANEL_BG()} wrap="wrap">{allText()}</text>
      </box>
    </Show>
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

  // Merge consecutive assistant messages into a single display block.
  // The agent loop creates a new assistant message per turn (text → tools → text).
  // In the panel we want one coherent "Assistant:" block, not one per turn.
  const mergedMessages = (): TuiMessage[] => {
    const out: TuiMessage[] = []
    for (const msg of props.panel.messages) {
      const last = out[out.length - 1]
      if (msg.role === "assistant" && last && last.role === "assistant") {
        out[out.length - 1] = { ...last, parts: [...last.parts, ...msg.parts] }
      } else {
        out.push({ ...msg, parts: [...msg.parts] })
      }
    }
    return out
  }

  // Inner width for separators (total minus left/right border chars)
  const innerWidth = () => PANEL_WIDTH - 2

  return (
    <box
      position="absolute"
      top={panelTop()}
      left={panelLeft()}
      width={PANEL_WIDTH}
      height={contentHeight() + 6}
      flexDirection="column"
      borderStyle="rounded"
      borderColor={PANEL_BORDER}
      backgroundColor={PANEL_BG()}
      zIndex={500}
    >
      {/* Messages */}
      <scrollbox
        ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
        paddingX={1}
        backgroundColor={PANEL_BG()}
        scrollbarOptions={{ visible: false }}
      >
        <box flexDirection="column" backgroundColor={PANEL_BG()}>
          <Show when={hasContent()} fallback={<box height={1} backgroundColor={PANEL_BG()} />}>
            <For each={mergedMessages()}>
              {(msg) => <CondensedMessage message={msg} />}
            </For>
            <Show when={workingLabel()}>
              <text fg={colors.muted} bg={PANEL_BG()}>{workingLabel()}</text>
            </Show>
          </Show>
        </box>
      </scrollbox>

      {/* Separator — spans full inner width (border-to-border) */}
      <text fg={PANEL_BORDER} bg={PANEL_BG()}>{"─".repeat(innerWidth())}</text>

      {/* Mini input */}
      <box flexDirection="row" paddingX={1} height={1} backgroundColor={PANEL_BG()}>
        <text fg={colors.primary} bg={PANEL_BG()}>{"> "}</text>
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
          backgroundColor={PANEL_BG()}
          keyBindings={[
            { name: "return", action: "submit" },
          ]}
        />
      </box>

      {/* Footer hint */}
      <box flexDirection="row" paddingX={1} height={1} backgroundColor={PANEL_BG()}>
        <box flexGrow={1} backgroundColor={PANEL_BG()} />
        <text fg={colors.textDim} bg={PANEL_BG()}>Enter submit · Esc cancel</text>
      </box>
    </box>
  )
}
