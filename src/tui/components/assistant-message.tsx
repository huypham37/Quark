// @jsxImportSource @opentui/solid
// Assistant messages use OpenTUI's MarkdownRenderable. Standalone local-file
// links become compact rows that Quark can open through the configured editor.

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { colors } from "../theme"
import { syntaxStyle } from "../syntax-theme"
import { splitMarkdownFileLinks } from "../markdown-file-links"
import type { FileTarget } from "../editor"

const DEBUG_LOG = Bun.env.QUARK_MD_DEBUG === "1"
const DEBUG_LOG_PATH = "/tmp/quark-md-debug.log"

function logDebug(label: string, text: string) {
  const timestamp = new Date().toISOString()
  const separator = "═".repeat(80)
  const entry = `\n${separator}\n${timestamp} [${label}]\n${separator}\n${text}\n${separator}\n`
  try {
    Bun.spawnSync({
      cmd: ["sh", "-c", `printf '%s' ${JSON.stringify(entry)} >> ${DEBUG_LOG_PATH}`],
      stdout: "ignore",
      stderr: "ignore",
    })
  } catch {}
}

interface AssistantMessageProps {
  text: string
  streaming?: boolean
  onOpenFile?: (target: FileTarget) => void
}

function prepareContent(text: string): string {
  if (DEBUG_LOG) logDebug("MARKDOWN (sent to <markdown>)", text)
  return text
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => (
  <Show when={props.text}>
    <box flexDirection="column" width="100%">
      {/* Keep one MarkdownRenderable alive while text arrives. Re-lexing into a
          new <For> on every delta remounts it and visibly flashes. */}
      <Show
        when={props.streaming}
        fallback={
          <For each={splitMarkdownFileLinks(props.text)}>
            {(segment) => segment.type === "markdown" ? (
              <markdown content={prepareContent(segment.content)} syntaxStyle={syntaxStyle} conceal={true} streaming={false} width="100%" />
            ) : (
              <box flexDirection="row" width="100%">
                <Show when={segment.marker}><text>{segment.marker}</text></Show>
                <For each={segment.parts}>
                  {(part) => "text" in part ? <text>{part.text}</text> : (
                    <box flexDirection="row" onMouseUp={() => props.onOpenFile?.(part.target)}>
                      <text fg={colors.info}>↗ </text>
                      <text fg={colors.info}><u>{part.label}</u></text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        }
      >
        <markdown content={prepareContent(props.text)} syntaxStyle={syntaxStyle} conceal={true} streaming={true} width="100%" />
      </Show>
    </box>
  </Show>
)
