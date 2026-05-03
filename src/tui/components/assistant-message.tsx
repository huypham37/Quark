// @jsxImportSource @opentui/solid
// AssistantMessage — renders assistant text as formatted markdown
//
// Uses OpenTUI's native <markdown> renderable which parses and renders
// markdown (headers, code blocks, lists, etc.) instead of
// <code filetype="markdown"> which only syntax-highlights the raw
// markdown source.
//
// IMPORTANT: In SolidJS, the component body runs ONCE. Never do early returns
// based on reactive props — use <Show> instead, so the rendering path stays
// reactive and re-evaluates when props change.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { syntaxStyle } from "../syntax-theme"

const DEBUG_LOG = Bun.env.QUARK_MD_DEBUG === "1"
const DEBUG_LOG_PATH = "/tmp/quark-md-debug.log"

function logDebug(label: string, text: string) {
  const timestamp = new Date().toISOString()
  const separator = "═".repeat(80)
  const entry = `\n${separator}\n${timestamp} [${label}]\n${separator}\n${text}\n${separator}\n`
  // Use synchronous append via shell to avoid async issues in reactive context
  try {
    Bun.spawnSync({
      cmd: ["sh", "-c", `printf '%s' ${JSON.stringify(entry)} >> ${DEBUG_LOG_PATH}`],
      stdout: "ignore",
      stderr: "ignore",
    })
  } catch {
    // silently ignore write errors
  }
}

interface AssistantMessageProps {
  text: string
  streaming?: boolean
}

/**
 * Replace "- " unordered list markers with "• " bullet glyphs.
 * Only touches lines starting with optional whitespace followed by "- "
 * that are NOT inside a fenced code block.
 */
function bulletizeMarkdown(text: string): string {
  const lines = text.split("\n")
  let inFence = false
  const out = lines.map((line) => {
    // Detect fenced code block boundaries (``` or ~~~)
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    return line.replace(/^(\s*)-([ \t])/, "$1•$2")
  })
  return out.join("\n")
}

/**
 * Prepares markdown content for rendering: logs debug info and applies
 * bulletize transformation. Called as a reactive expression so it fires
 * on every text change (streaming deltas).
 */
function prepareContent(text: string): string {
  if (DEBUG_LOG) {
    logDebug("RAW (before bulletize)", text)
    const result = bulletizeMarkdown(text)
    logDebug("POST-BULLETIZE (sent to <markdown>)", result)
    return result
  }
  return bulletizeMarkdown(text)
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <Show when={props.text}>
      <box flexDirection="column" width="100%">
        <markdown content={prepareContent(props.text)} syntaxStyle={syntaxStyle} streaming={props.streaming ?? false} />
      </box>
    </Show>
  )
}
