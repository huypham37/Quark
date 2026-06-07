// @jsxImportSource @opentui/solid
// FooterBar — bottom bar showing running status, git branch, and working directory
//
// Always renders 1 row to keep layout stable (no height jumps).
// When running: "⠋ Conjuring…      Esc to cancel"  (animated spinner + cycling label)
// When steering: "⠋ Steering context…"
// When idle: empty line
// Right side shows git branch (if in a repo) and abbreviated cwd path.
//
// The right side adapts to terminal width: cwd shrinks first (full → ~/…/leaf →
// …/leaf), then branch middle-truncates (fix/gh-135-…-redesign), then tail-
// truncates (fix/…). The left zone (status + cancel hint) is never truncated.
// Pure shrink helpers live in ./footer-bar-fit.ts so they can be unit-tested.
//
// Streaming labels cycle every 4s: Streaming → Conjuring… → Brewing… → etc.

import type { Component } from "solid-js"
import { Show, createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme"
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS, STREAMING_LABELS, LABEL_CYCLE_INTERVAL_MS } from "../spinner"
import {
  APP_PADDING_X_TOTAL,
  ZONE_GAP,
  pickRightZone,
  leftWidthRunning,
  LEFT_WIDTH_STEERING,
  LEFT_WIDTH_IDLE,
} from "./footer-bar-fit"

export interface FooterBarProps {
  running: boolean
  steering?: boolean
  /** Override for cwd (worktree-aware). Falls back to process.cwd() if not provided. */
  cwd?: string
  /** Override for git branch (worktree-aware). Falls back to auto-detection if not provided. */
  branch?: string | null
}

function getGitBranch(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if (result.exitCode === 0) {
      return result.stdout.toString().trim()
    }
  } catch {
    // Not a git repo or git not available
  }
  return ""
}

export const FooterBar: Component<FooterBarProps> = (props) => {
  const dims = useTerminalDimensions()
  const cwd = () => props.cwd ?? process.cwd()
  const [detectedBranch, setDetectedBranch] = createSignal(getGitBranch())
  const branch = () => props.branch ?? detectedBranch()
  const [frameIndex, setFrameIndex] = createSignal(0)
  const [labelIndex, setLabelIndex] = createSignal(0)

  // Poll git branch every 5 seconds so the footer stays current
  createEffect(() => {
    const id = setInterval(() => {
      setDetectedBranch(getGitBranch())
    }, 5_000)
    onCleanup(() => clearInterval(id))
  })

  // Animate spinner when running or steering
  createEffect(() => {
    if (!props.running && !props.steering) {
      setFrameIndex(0)
      setLabelIndex(0)
      return
    }
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  // Cycle streaming label text
  createEffect(() => {
    if (!props.running) {
      setLabelIndex(0)
      return
    }
    const id = setInterval(() => {
      setLabelIndex((i) => (i + 1) % STREAMING_LABELS.length)
    }, LABEL_CYCLE_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  const spinnerChar = () => SPINNER_FRAMES[frameIndex()]
  const currentLabel = () => STREAMING_LABELS[labelIndex()]!

  // Adaptive right zone — recomputes when terminal width, branch, running
  // state, steering state, or current label change.
  const rightZone = createMemo(() => {
    const leftWidth = props.steering
      ? LEFT_WIDTH_STEERING
      : props.running
        ? leftWidthRunning(currentLabel())
        : LEFT_WIDTH_IDLE
    const budget = dims().width - APP_PADDING_X_TOTAL - leftWidth - ZONE_GAP
    return pickRightZone(branch(), cwd(), budget)
  })

  return (
    <box flexDirection="row" justifyContent="space-between" height={1}>
      <Show
        when={props.steering}
        fallback={
          <Show
            when={props.running}
            fallback={<text> </text>}
          >
            <box flexDirection="row">
              <text fg={colors.primary} bold>{spinnerChar()} </text>
              <text>{currentLabel()}</text>
              <text>      </text>
              <text fg={colors.footerKey} bold>Esc</text>
              <text fg={colors.muted}> to cancel</text>
            </box>
          </Show>
        }
      >
        <box flexDirection="row">
          <text fg={colors.warning} bold>{spinnerChar()} </text>
          <text>Steering context…</text>
        </box>
      </Show>
      <box flexDirection="row">
        <Show when={rightZone().branch}>
          <text fg={colors.muted}> {rightZone().branch}</text>
          <Show when={rightZone().cwd}>
            <text fg={colors.muted}> · </text>
          </Show>
        </Show>
        <Show when={rightZone().cwd}>
          <text fg={colors.muted}>{rightZone().cwd}</text>
        </Show>
      </box>
    </box>
  )
}
