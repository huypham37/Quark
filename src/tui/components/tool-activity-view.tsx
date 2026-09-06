// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { For, Show, createSignal } from "solid-js"
import { colors } from "../theme"
import { ShimmerText } from "./shimmer-text"
import { ToolCard } from "./tool-card"
import { ACTIVITY_LABELS, type ToolActivityKind, type ToolPart } from "./tool-activity"

interface ToolActivityProps {
  kind: ToolActivityKind
  tools: ToolPart[]
  continuingToolCallId?: string | null
}

export const ToolActivity: Component<ToolActivityProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)
  const active = () => props.tools.some((tool) =>
    tool.status === "pending"
    || tool.status === "running"
    || tool.callId === props.continuingToolCallId
  )
  const errorCount = () => props.tools.filter((tool) => tool.status === "error").length
  const label = () => ACTIVITY_LABELS[props.kind][active() ? "active" : "done"]
  const statusColor = () => errorCount() ? colors.error : active() ? colors.info : colors.success

  return (
    <box flexDirection="column">
      <box flexDirection="row" onMouseUp={() => setExpanded((value) => !value)}>
        <text fg={statusColor()}>• </text>
        <box width={24} flexShrink={0}>
          <Show
            when={active()}
            fallback={<text fg={errorCount() ? colors.error : colors.text}><i>{label()}</i></text>}
          >
            <ShimmerText text={`${label()}…`} color={colors.text} background={colors.notificationBg} />
          </Show>
        </box>
        <text fg={colors.muted}>{expanded() ? "▾" : "▸"}</text>
        <Show when={errorCount() > 0}>
          <text fg={colors.error}> · {errorCount()} failed</text>
        </Show>
      </box>

      <Show when={expanded()}>
        <box flexDirection="column" paddingLeft={2} marginTop={1}>
          <For each={props.tools}>
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
                />
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
