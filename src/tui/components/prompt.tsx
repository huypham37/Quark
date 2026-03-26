// @jsxImportSource @opentui/solid
// Prompt — input area with status line
//
// Uses OpenTUI's <textarea> renderable for multiline text input.
// Status line (tokens, cost, model, skills) is rendered above the input.
// App.tsx owns autocomplete state; this component just renders the input
// and forwards events upward.

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"

function modelColor(name: string): RGBA {
  if (name.startsWith("claude")) return RGBA.fromHex("#d4a574") // warm orange for Anthropic
  if (name.startsWith("gemini")) return RGBA.fromHex("#4285f4") // blue for Google
  if (name.startsWith("o1") || name.startsWith("o3") || name.startsWith("o4")) return RGBA.fromHex("#10a37f") // green for OpenAI reasoning
  return RGBA.fromHex("#10a37f") // green for OpenAI (gpt-*)
}

export interface PromptProps {
  /** Callback when user submits (Cmd+Enter / Ctrl+Enter) — receives trimmed text */
  onSubmit: (text: string) => void
  /** Callback on every content change with current input value */
  onContentChange: () => void
  /** Whether the input is disabled (agent running, permission prompt) */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Expose the TextareaRenderable ref to parent (for imperative .value set) */
  onRef?: (ref: TextareaRenderable) => void
  // Status info
  tokensUsed?: number
  tokenLimit?: number
  cost?: number
  modelName?: string
  skillCount?: number
  /** Pending image attachments to display as [Image N] chips */
  images?: { label: string }[]
  /** Index of the currently selected image chip (null = none selected) */
  selectedImageIndex?: number | null
  /** Called when user removes the image at the given index */
  onRemoveImage?: (index: number) => void
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPercent(used: number, limit: number): string {
  if (limit <= 0) return "0%"
  return `${Math.round((used / limit) * 100)}%`
}

export const Prompt: Component<PromptProps> = (props) => {
  let textareaRef: TextareaRenderable | undefined

  const leftStatus = () => {
    const used = props.tokensUsed ?? 0
    const limit = props.tokenLimit ?? 168000
    const cost = props.cost ?? 0
    return `${formatPercent(used, limit)} · ${formatTokens(used)} of ${formatTokens(limit)}`
  }

  const modelName = () => props.modelName ?? "smart"
  const skillsText = () => {
    const skills = props.skillCount ?? 0
    return `${skills} skill${skills !== 1 ? "s" : ""}`
  }

  const borderColor = () => props.disabled ? colors.muted : colors.success

  const handleSubmit = () => {
    if (!textareaRef) return
    const text = textareaRef.plainText.trim()
    if (!text) return
    props.onSubmit(text)
  }

  const handleContentChange = () => {
    props.onContentChange()
  }

  const handleRef = (r: TextareaRenderable) => {
    textareaRef = r
    props.onRef?.(r)
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Status line — single row, flex-based filler */}
      <box flexDirection="row" height={1} overflow="hidden">
        <text fg={borderColor()} flexShrink={0}>╭── </text>
        <text fg={colors.statusLine} flexShrink={0}>{leftStatus()}</text>
        <text fg={borderColor()} flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">{" " + "─".repeat(300) + " "}</text>
        <text fg={modelColor(modelName())} flexShrink={0}>{modelName()}</text>
        <text fg={borderColor()} flexShrink={0}>─</text>
        <text fg={borderColor()} flexShrink={0}> ──╮</text>
      </box>

      {/* Input box — no top border since status line acts as top edge */}
      <box
        flexDirection="column"
        borderStyle="rounded"
        borderColor={borderColor()}
        border={["left", "right", "bottom"]}
        paddingX={1}
        minHeight={4}
      >
        {/* Image attachment chips — Tab to select, Backspace/Delete to remove */}
        <Show when={(props.images?.length ?? 0) > 0}>
          <box flexDirection="row" flexWrap="wrap" marginBottom={1}>
            <For each={props.images}>
              {(img, i) => {
                const selected = () => props.selectedImageIndex === i()
                return (
                  <text fg={selected() ? colors.error : colors.success}>
                    [{img.label}{selected() ? " ×" : ""}]{" "}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <Show
          when={!props.disabled}
          fallback={<text fg={colors.muted}>Agent is running... (Esc to cancel)</text>}
        >
          <textarea
            ref={handleRef}
            focused={!props.disabled}
            placeholder={props.placeholder ?? "Type a message... (Enter to send)"}
            cursorColor={colors.cursorColor}
            cursorStyle={{ style: "line", blinking: true }}
            onSubmit={handleSubmit}
            onContentChange={handleContentChange}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              // Undo/redo: Ctrl+Z (Linux/Windows), Meta+Z and Super+Z (Mac Command key)
              { name: "z", ctrl: true, action: "undo" },
              { name: "z", ctrl: true, shift: true, action: "redo" },
              { name: "z", meta: true, action: "undo" },
              { name: "z", meta: true, shift: true, action: "redo" },
              { name: "z", super: true, action: "undo" },
              { name: "z", super: true, shift: true, action: "redo" },
              { name: "Z", meta: true, action: "redo" },
              { name: "Z", super: true, action: "redo" },
              // Fallback: Option+Z for undo on Mac (if terminal captures Command+Z)
              { name: "ω", action: "undo" },  // Option+Z produces ω on Mac
              { name: "Ω", action: "redo" },  // Option+Shift+Z produces Ω on Mac
            ]}
          />
        </Show>
      </box>
    </box>
  )
}
