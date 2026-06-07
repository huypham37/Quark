// @jsxImportSource @opentui/solid
// FooterBar — bottom bar showing running status, git branch, and working directory
//
// Always renders 1 row to keep layout stable (no height jumps).
// When running:    "Working      Esc to cancel"  (shimmering status text)
// When steering:   "Steering context…"           (shimmering status text)
// When just done:  "Worked for X.Xs"             (italic, muted, persists until next request)
// When idle:       empty line
// Right side shows git branch (if in a repo) and abbreviated cwd path.
//
// The status text uses a per-letter shimmer (ShimmerText) instead of a spinner:
// a bright highlight sweeps left-to-right across the word while the agent works.
//
// After the agent finishes, the footer shows "Worked for X.Xs" in italic,
// persisting until the next user request so the user always sees the last
// turn duration.
//
// The right side adapts to terminal width: cwd shrinks first (full → ~/…/leaf →
// …/leaf), then branch middle-truncates (fix/gh-135-…-redesign), then tail-
// truncates (fix/…). The left zone (status + cancel hint) is never truncated.
// Pure shrink helpers live in ./footer-bar-fit.ts so they can be unit-tested.

import type { Component } from "solid-js"
import { Show, createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { colors } from "../theme"
import { ShimmerText } from "./shimmer-text"
import {
  APP_PADDING_X_TOTAL,
  ZONE_GAP,
  pickRightZone,
  leftWidthRunning,
  LEFT_WIDTH_STEERING,
  LEFT_WIDTH_IDLE,
  formatDuration,
  durationWidth,
} from "./footer-bar-fit"

export interface FooterBarProps {
  running: boolean
  steering?: boolean
  /** Duration (ms) of the last completed agent run, from user message to assistant finish */
  lastDuration: number | null
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
  const cwd = process.cwd()
  const [branch, setBranch] = createSignal(getGitBranch())

  // Poll git branch every 5 seconds so the footer stays current
  createEffect(() => {
    const id = setInterval(() => {
      setBranch(getGitBranch())
    }, 5_000)
    onCleanup(() => clearInterval(id))
  })

  const RUNNING_LABEL = "Working"
  const STEERING_LABEL = "Steering context…"

  // "Worked for X.Xs" label — shown after agent finishes, persists until next request.
  const workedLabel = createMemo(() =>
    props.lastDuration != null ? formatDuration(props.lastDuration) : null,
  )

  // Adaptive right zone — recomputes when terminal width, branch, running
  // state, steering state, or worked label change.
  const rightZone = createMemo(() => {
    const leftWidth = props.steering
      ? LEFT_WIDTH_STEERING
      : props.running
        ? leftWidthRunning(RUNNING_LABEL)
        : workedLabel()
          ? durationWidth(workedLabel()!)
          : LEFT_WIDTH_IDLE
    const budget = dims().width - APP_PADDING_X_TOTAL - leftWidth - ZONE_GAP
    return pickRightZone(branch(), cwd, budget)
  })

  return (
    <box flexDirection="row" justifyContent="space-between" height={1}>
      <Show
        when={props.steering}
        fallback={
          <Show
            when={props.running}
            fallback={
              <Show when={workedLabel()} fallback={<text> </text>}>
                {(label) => (
                  <text fg={colors.muted} italic>{label()}</text>
                )}
              </Show>
            }
          >
            <box flexDirection="row">
              <ShimmerText text={RUNNING_LABEL} color={colors.text} background={colors.notificationBg} />
              <text>      </text>
              <text fg={colors.footerKey} bold>Esc</text>
              <text fg={colors.muted}> to cancel</text>
            </box>
          </Show>
        }
      >
        <box flexDirection="row">
          <ShimmerText text={STEERING_LABEL} color={colors.warning} background={colors.notificationBg} />
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
