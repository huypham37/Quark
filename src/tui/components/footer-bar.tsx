// @jsxImportSource @opentui/solid
// FooterBar — bottom bar showing running status, git branch, and working directory
//
// Always renders 1 row to keep layout stable (no height jumps).
// When running: "⠋ Streaming      Esc to cancel"  (animated braille spinner)
// When idle: empty line
// Right side shows git branch (if in a repo) and abbreviated cwd path.

import type { Component } from "solid-js"
import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { colors } from "../theme"
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../spinner"

export interface FooterBarProps {
  running: boolean
  compacting?: boolean
}

function abbreviatePath(fullPath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  if (home && fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length)
  }
  return fullPath
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
  const cwd = abbreviatePath(process.cwd())
  const [branch] = createSignal(getGitBranch())
  const [frameIndex, setFrameIndex] = createSignal(0)

  // Animate spinner when running or compacting
  createEffect(() => {
    if (!props.running && !props.compacting) {
      setFrameIndex(0)
      return
    }
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  const spinnerChar = () => SPINNER_FRAMES[frameIndex()]

  return (
    <box flexDirection="row" justifyContent="space-between" height={1}>
      <Show
        when={props.compacting}
        fallback={
          <Show
            when={props.running}
            fallback={<text> </text>}
          >
            <box flexDirection="row">
              <text fg={colors.primary} bold>{spinnerChar()} </text>
              <text>Streaming</text>
              <text>      </text>
              <text fg={colors.footerKey} bold>Esc</text>
              <text fg={colors.muted}> to cancel</text>
            </box>
          </Show>
        }
      >
        <box flexDirection="row">
          <text fg={colors.warning} bold>{spinnerChar()} </text>
          <text>Compacting context…</text>
        </box>
      </Show>
      <box flexDirection="row">
        <Show when={branch()}>
          <text fg={colors.success}> {branch()}</text>
          <text fg={colors.muted}> · </text>
        </Show>
        <text fg={colors.muted}>{cwd}</text>
      </box>
    </box>
  )
}
