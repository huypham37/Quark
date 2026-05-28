// @jsxImportSource @opentui/solid
// Prompt — input area with status line
//
// Uses OpenTUI's <textarea> renderable for multiline text input.
// Status line (tokens, cost, model, skills) is rendered above the input.
// App.tsx owns autocomplete state; this component just renders the input
// and forwards events upward.

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import type { TextareaRenderable, PasteEvent } from "@opentui/core"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"

// Paste-collapse thresholds: if pasted text exceeds either limit, replace
// it with a `[Pasted #N +X lines]` placeholder and stash the real content
// in a side buffer until submit. Keeps the input box readable and prevents
// it from blowing past `maxHeight`.
const PASTE_CHAR_THRESHOLD = 400
const PASTE_LINE_THRESHOLD = 6
const PASTE_TOKEN_RE = /\[Pasted #(\d+) \+\d+ lines\]/g

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
  /** Current thinking effort level ("none" = off) */
  thinkingEffort?: string
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

  // Side-buffer for collapsed pastes. Keyed by the numeric id embedded in
  // the placeholder token. Survives across edits; entries are dropped when
  // the message is submitted (cleared in `handleSubmit`).
  const pasteBuffer = new Map<number, string>()
  let pasteCounter = 0

  const leftStatus = () => {
    const used = props.tokensUsed ?? 0
    const limit = props.tokenLimit ?? 0
    const cost = props.cost ?? 0
    return `${formatPercent(used, limit)} · ${formatTokens(used)} of ${formatTokens(limit)}`
  }

  const modelName = () => props.modelName ?? "smart"
  const skillsText = () => {
    const skills = props.skillCount ?? 0
    return `${skills} skill${skills !== 1 ? "s" : ""}`
  }

  const borderColor = () => colors.outline

  // Replace every `[Pasted #N +X lines]` placeholder with its stashed text.
  // Unknown ids (user typed the token by hand, or the entry was already
  // consumed) are left in place verbatim.
  const expandPastes = (text: string): string => {
    return text.replace(PASTE_TOKEN_RE, (match, idStr) => {
      const id = Number(idStr)
      const stashed = pasteBuffer.get(id)
      return stashed ?? match
    })
  }

  const handleSubmit = () => {
    if (!textareaRef) return
    const raw = textareaRef.plainText.trim()
    if (!raw) return
    const expanded = expandPastes(raw)
    pasteBuffer.clear()
    props.onSubmit(expanded)
  }

  const handleContentChange = () => {
    props.onContentChange()
  }

  // Intercept paste events: if the payload exceeds either threshold, swap
  // it for a short `[Pasted #N +X lines]` token and stash the real content.
  // Small pastes fall through to the textarea's default insert behavior.
  const handlePaste = (event: PasteEvent) => {
    if (!textareaRef) return
    const text = event.text
    const lineCount = text.split("\n").length
    const charCount = text.length
    if (charCount <= PASTE_CHAR_THRESHOLD && lineCount <= PASTE_LINE_THRESHOLD) {
      return // small paste — let default handler insert as-is
    }
    event.preventDefault()
    const id = ++pasteCounter
    pasteBuffer.set(id, text)
    const token = `[Pasted #${id} +${lineCount} lines]`
    textareaRef.insertText(token)
  }

  const handleRef = (r: TextareaRenderable) => {
    textareaRef = r
    r.onPaste = handlePaste
    props.onRef?.(r)
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Status line — single row, flex-based filler */}
      <box flexDirection="row" height={1} overflow="hidden">
        <text fg={borderColor()} flexShrink={0}>╭── </text>
        <text fg={colors.statusLine} flexShrink={0}>{leftStatus()}</text>
        <text fg={borderColor()} flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">{" " + "─".repeat(300) + " "}</text>
        <Show when={props.thinkingEffort && props.thinkingEffort !== "none"}>
          <text fg={RGBA.fromHex("#a78bfa")} flexShrink={0}>[T:{props.thinkingEffort}]─</text>
        </Show>
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
        maxHeight={8}
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
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.textDim}
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
