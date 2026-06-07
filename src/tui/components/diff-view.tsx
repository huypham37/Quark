// @jsxImportSource @opentui/solid
// DiffView — renders a unified diff inline in the tool result row
//
// Visual style:
//
//   └── src/tui/components/tool-result.tsx  +3 -1
//       ─────────────────────────────────────
//        64│ function getToolDisplayName(tool: string)
//       -65│   read: "Read",
//       +65│   read: "Read",
//       +66│   write: "Write",
//        67│ }
//       ─────────────────────────────────────

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { colors } from "../theme"
import { parseDiffHunks } from "../../shared/diff-utils"
import type { DiffHunk, DiffLine } from "../../shared/diff-utils"

interface DiffViewProps {
  diff: string
  filePath?: string
}

const MAX_LINES_PER_HUNK = 100
const MAX_HUNKS = 10

const COLOR_ADDED    = RGBA.fromHex("#3a5c3a")  // dark green bg feel via text color
const COLOR_REMOVED  = RGBA.fromHex("#5c3a3a")  // dark red bg feel via text color
const COLOR_ADDED_FG = RGBA.fromHex("#98C379")  // bright green text
const COLOR_REMOVED_FG = RGBA.fromHex("#E06C75") // bright red text
const COLOR_LINENUM  = RGBA.fromHex("#4a5568")   // muted blue-gray
const COLOR_RULE     = RGBA.fromHex("#2d3748")   // very dark rule line
const COLOR_FILEPATH = RGBA.fromHex("#61AFEF")   // blue

function countChanges(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.type === "added") added++
      else if (l.type === "removed") removed++
    }
  }
  return { added, removed }
}

function computeMaxDigits(hunks: DiffHunk[]): number {
  let max = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      const n = l.newLineNo ?? l.oldLineNo
      if (n != null) {
        const digits = String(n).length
        if (digits > max) max = digits
      }
    }
  }
  return Math.max(1, max)
}

const DiffLineView: Component<{ line: DiffLine; maxDigits: number }> = (props) => {
  const prefix = () => {
    if (props.line.type === "added") return "+"
    if (props.line.type === "removed") return "-"
    return " "
  }

  const lineNo = () => {
    const n = props.line.type === "added"
      ? props.line.newLineNo
      : props.line.type === "removed"
      ? props.line.oldLineNo
      : props.line.newLineNo ?? props.line.oldLineNo
    const pad = props.maxDigits
    return n != null ? String(n).padStart(pad) : " ".repeat(pad)
  }

  const fgColor = () => {
    if (props.line.type === "added") return COLOR_ADDED_FG
    if (props.line.type === "removed") return COLOR_REMOVED_FG
    return colors.textDim
  }

  const prefixColor = () => {
    if (props.line.type === "added") return COLOR_ADDED_FG
    if (props.line.type === "removed") return COLOR_REMOVED_FG
    return colors.muted
  }

  return (
    <box flexDirection="row">
      <text fg={COLOR_LINENUM} flexShrink={0}>{lineNo()}</text>
      <text fg={colors.muted} flexShrink={0}>│</text>
      <text fg={prefixColor()} flexShrink={0}>{prefix()}</text>
      <text fg={fgColor()} wrap="wrap" flexShrink={1}>{props.line.content}</text>
    </box>
  )
}

const HunkView: Component<{ hunk: DiffHunk; maxDigits: number }> = (props) => {
  const visibleLines = () => props.hunk.lines.slice(0, MAX_LINES_PER_HUNK)
  const overflow = () => props.hunk.lines.length - MAX_LINES_PER_HUNK
  const indent = () => " ".repeat(props.maxDigits + 1)

  return (
    <box flexDirection="column">
      <For each={visibleLines()}>
        {(line) => <DiffLineView line={line} maxDigits={props.maxDigits} />}
      </For>
      <Show when={overflow() > 0}>
        <text fg={colors.muted}>{indent()}… {overflow()} more lines</text>
      </Show>
    </box>
  )
}

export const DiffView: Component<DiffViewProps> = (props) => {
  const dims = useTerminalDimensions()
  const hunks = () => parseDiffHunks(props.diff)
  const visibleHunks = () => hunks().slice(0, MAX_HUNKS)
  const overflowHunks = () => hunks().length - MAX_HUNKS
  const changes = () => countChanges(hunks())
  const maxDigits = () => computeMaxDigits(hunks())
  const rule = () => "─".repeat(Math.max(10, dims().width - 8))

  return (
    <Show when={hunks().length > 0}>
      <box flexDirection="column" marginLeft={0}>
        {/* File path + change summary */}
        <box flexDirection="row">
          <text fg={colors.muted}>└── </text>
          <Show when={props.filePath}>
            <text fg={COLOR_FILEPATH}>{props.filePath!.replace(/^\/Users\/[^/]+\//, "~/")}</text>
            <text> </text>
          </Show>
          <text fg={COLOR_ADDED_FG}>+{changes().added}</text>
          <text> </text>
          <text fg={COLOR_REMOVED_FG}>-{changes().removed}</text>
        </box>
        {/* Hunks */}
        <box flexDirection="column">
          <text fg={COLOR_RULE}>{rule()}</text>
          <For each={visibleHunks()}>
            {(hunk, i) => (
              <box flexDirection="column">
                <HunkView hunk={hunk} maxDigits={maxDigits()} />
                <Show when={i() < visibleHunks().length - 1}>
                  <text fg={COLOR_RULE}>{rule()}</text>
                </Show>
              </box>
            )}
          </For>
          <text fg={COLOR_RULE}>{rule()}</text>
          <Show when={overflowHunks() > 0}>
            <text fg={colors.muted}>… {overflowHunks()} more hunk{overflowHunks() > 1 ? "s" : ""}</text>
          </Show>
        </box>
      </box>
    </Show>
  )
}
