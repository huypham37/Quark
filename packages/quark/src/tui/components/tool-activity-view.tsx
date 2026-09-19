// @jsxImportSource @opentui/solid
//
// ToolActivity — the summary line for a run of same-purpose tool calls.
//
// The summary detail level owns disclosure:
//
//   quiet   just this line, no chevron, nothing behind it
//   normal  line + the individual tool call rows (headers only)
//   loud    line + tool calls + their results (diff, stdout, write stream)
//
// "Hide read-only tools" additionally drops read/grep/glob rows from an explore
// run, so a long search sequence collapses to the summary even at loud.
//
// Clicking does nothing: a settings toggle that can be silently undone by a
// stray click is worse than no toggle. Change the level in /settings.

import type { Component } from "solid-js"
import { For, Show } from "solid-js"
import { colors } from "../theme"
import { ShimmerText } from "./shimmer-text"
import { ToolCard } from "./tool-card"
import { ACTIVITY_LABELS, type ToolActivityKind, type ToolPart } from "./tool-activity"
import { summaryDetail, transcriptVisibility } from "../settings-store"
import type { SummaryDetail } from "../../config/config"
import { READ_ONLY_TOOLS } from "@quark/runner/tool/tool"

interface ToolActivityProps {
  kind: ToolActivityKind
  tools: ToolPart[]
  continuingToolCallId?: string | null
  /** Overrides the live setting. Used by tests and previews. */
  level?: SummaryDetail
}

export const ToolActivity: Component<ToolActivityProps> = (props) => {
  const level = () => props.level ?? summaryDetail()
  const visibility = () => transcriptVisibility(level())
  const active = () => props.tools.some((tool) =>
    tool.status === "pending"
    || tool.status === "running"
    || tool.callId === props.continuingToolCallId
  )
  // Only the explore activity is thinned out: hiding webfetch/bash rows would
  // erase whole activities instead of decluttering one.
  const shownTools = () => visibility().hideReadonly && props.kind === "explore"
    ? props.tools.filter((tool) => !READ_ONLY_TOOLS.has(tool.tool))
    : props.tools
  const bodyVisible = () => visibility().expanded && shownTools().length > 0
  const errorCount = () => props.tools.filter((tool) => tool.status === "error").length
  const label = () => ACTIVITY_LABELS[props.kind][active() ? "active" : "done"]
  const statusColor = () => errorCount() ? colors.error : active() ? colors.info : colors.success

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={statusColor()}>• </text>
        <box width={24} flexShrink={0}>
          <Show
            when={active()}
            fallback={<text fg={errorCount() ? colors.error : colors.text}><i>{label()}</i></text>}
          >
            <ShimmerText text={`${label()}…`} color={colors.text} background={colors.notificationBg} />
          </Show>
        </box>
        <Show when={bodyVisible()}>
          <text fg={colors.muted}>▾</text>
        </Show>
        <Show when={errorCount() > 0}>
          <text fg={colors.error}> · {errorCount()} failed</text>
        </Show>
      </box>

      <Show when={bodyVisible()}>
        <box flexDirection="column" paddingLeft={2} marginTop={1}>
          <For each={shownTools()}>
            {(tool) => (
              <box marginBottom={1}>
                <ToolCard
                  tool={tool.tool}
                  status={tool.status}
                  input={tool.input}
                  output={tool.output}
                  error={tool.error}
                  diff={tool.diff}
                  streamingContent={tool.streamingContent}
                  showResult={visibility().results}
                />
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
