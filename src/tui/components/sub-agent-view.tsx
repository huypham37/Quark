// @jsxImportSource @opentui/solid

import type { Component } from "solid-js"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { colors } from "../theme"
import type { SubAgentState, SubAgentToolPart } from "../state"
import { ToolCard } from "./tool-card"
import { SubAgentTokenMeter } from "./sub-agent-token-meter"

interface SubAgentViewProps {
  subAgent: SubAgentState
  parentStatus: "pending" | "awaiting_approval" | "running" | "completed" | "error"
  defaultExpanded?: boolean
}

const ChildToolLine: Component<{ tool: SubAgentToolPart }> = (props) => (
  <box paddingLeft={2}>
    <ToolCard
      tool={props.tool.tool}
      status={props.tool.status}
      input={props.tool.input}
      error={props.tool.error}
    />
  </box>
)

function formatSeconds(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000))
  return `${secs}s`
}

export const SubAgentView: Component<SubAgentViewProps> = (props) => {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false)
  const [liveMs, setLiveMs] = createSignal(0)

  createEffect(() => {
    if (props.subAgent.done) setExpanded(false)
  })

  // Live timer: tick every second while running
  createEffect(() => {
    if (props.subAgent.done || props.subAgent.startedAt == null) {
      setLiveMs(0)
      return
    }
    const tick = () => setLiveMs(Date.now() - props.subAgent.startedAt!)
    tick()
    const id = setInterval(tick, 1000)
    onCleanup(() => clearInterval(id))
  })

  const profileName = () => {
    const profile = props.subAgent.profile
    return profile.charAt(0).toUpperCase() + profile.slice(1)
  }

  const isError = () => props.parentStatus === "error" || !!props.subAgent.error
  const isDone = () => props.subAgent.done
  const isWaiting = () => props.subAgent.tools.some((tool) => tool.status === "awaiting_approval")
  const statusColor = () => isError() ? colors.error : isDone() ? colors.success : colors.warning
  const borderColor = () => isError() ? colors.error : isDone() ? colors.borderSuccess : colors.borderActive

  const durationLabel = () => {
    if (isDone() && props.subAgent.durationMs != null) return ` (${formatSeconds(props.subAgent.durationMs)})`
    if (isError() && props.subAgent.durationMs != null) return ` (${formatSeconds(props.subAgent.durationMs)})`
    if (!isDone() && !isError() && props.subAgent.startedAt != null && liveMs() > 0) return ` (${formatSeconds(liveMs())})`
    return ""
  }

  const headerLabel = () => {
    if (isError()) return `${profileName()} failed`
    if (isDone()) return `${profileName()} responded`
    if (isWaiting()) return `${profileName()} waiting for approval`
    return `Summoning ${profileName()}`
  }

  const hasDetails = () => !!props.subAgent.prompt || props.subAgent.tools.length > 0 || !!props.subAgent.textPreview || !!props.subAgent.error

  return (
    <box
      flexDirection="column"
      width="50%"
      borderStyle="rounded"
      borderColor={borderColor()}
      backgroundColor={colors.commandCardBg}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <box flexDirection="row" backgroundColor={colors.commandCardBg}>
        <text fg={statusColor()} flexShrink={0}>● </text>
        <text bold fg={colors.text} flexShrink={0}>{headerLabel()}{durationLabel()}</text>
        <box flexGrow={1} backgroundColor={colors.commandCardBg} />
        <Show when={props.subAgent.modelName || props.subAgent.profile} fallback={null}>
          <text fg={colors.muted} flexShrink={1}>{props.subAgent.modelName ?? profileName()}</text>
        </Show>
      </box>

      <SubAgentTokenMeter
        tokensUsed={props.subAgent.tokensUsed}
        tokenLimit={props.subAgent.tokenLimit}
        color={statusColor()}
      />

      <Show when={hasDetails()}>
        <box flexDirection="column" backgroundColor={colors.commandCardBg}>
          <box
            flexDirection="row"
            backgroundColor={colors.commandCardBg}
            onMouseUp={() => setExpanded((value) => !value)}
          >
            <Show when={expanded()} fallback={<text fg={colors.muted}>▶ Task:</text>}>
              <text fg={colors.muted} flexShrink={0}>Task:</text>
              <Show when={props.subAgent.prompt}>
                <text fg={colors.toolPath} wrap="wrap"> {`"${props.subAgent.prompt}"`}</text>
              </Show>
              <text fg={colors.muted} flexShrink={0}> ▼</text>
            </Show>
          </box>

          <Show when={expanded()}>
            <For each={props.subAgent.tools}>
              {(tool) => <ChildToolLine tool={tool} />}
            </For>
            <Show when={!isDone() && props.subAgent.textPreview}>
              <box paddingLeft={2}>
                <text fg={colors.muted}>● Thinking...</text>
              </box>
            </Show>
            <Show when={props.subAgent.error}>
              <box paddingLeft={2}>
                <text fg={colors.error} wrap="wrap">
                  {props.subAgent.error!.kind}: {props.subAgent.error!.message}
                </text>
              </box>
            </Show>
          </Show>

        </box>
      </Show>
    </box>
  )
}
