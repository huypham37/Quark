// @jsxImportSource @opentui/solid
// MessageItem — renders a single message (user or assistant) with all its parts
//
// Dispatches to the appropriate sub-component based on part type:
// - text → AssistantMessage (or UserMessage for user role)
// - tool → grouped ToolActivity (individual ToolCards are disclosed on demand)
// - thinking → intentionally not rendered

import type { Component } from "solid-js"
import { Show, Switch, Match, Index, createMemo } from "solid-js"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"
import { ToolActivity } from "./tool-activity-view"
import { groupMessageParts, type ToolActivityItem } from "./tool-activity"
import { SubAgentView } from "./sub-agent-view"
import type { TuiMessage, TuiPart } from "../state"
import type { FileTarget } from "../editor"

interface MessageItemProps {
  message: TuiMessage
  continuingToolCallId?: string | null
  onOpenFile?: (target: FileTarget) => void
}

const PartView: Component<{ part: TuiPart; onOpenFile?: (target: FileTarget) => void }> = (props) => {
  // Helper to cast tool parts
  const asTool = () => props.part as Extract<TuiPart, { type: "tool" }>

  return (
    <Switch>
      <Match when={props.part.type === "text" && props.part}>
        {(part) => (
          <box marginBottom={1}>
            <AssistantMessage
              text={(part() as Extract<TuiPart, { type: "text" }>).text}
              streaming={(part() as Extract<TuiPart, { type: "text" }>).streaming}
              onOpenFile={props.onOpenFile}
            />
          </box>
        )}
      </Match>

      {/* First-class subagent calls and legacy replay state use the same view. */}
      <Match when={props.part.type === "tool" && asTool().subAgent}>
        <box marginBottom={1}>
          <SubAgentView subAgent={asTool().subAgent!} parentStatus={asTool().status} />
        </box>
      </Match>

    </Switch>
  )
}

export const MessageItem: Component<MessageItemProps> = (props) => {
  const displayItems = createMemo(() => groupMessageParts(props.message.parts))

  return (
    <Show
      when={props.message.role === "assistant"}
      fallback={
        // User messages: text + optional image parts
        <Show when={props.message.parts.find((p) => p.type === "text") as Extract<TuiPart, { type: "text" }> | undefined}>
          {(textPart) => {
            const images = () => props.message.parts
              .filter((p): p is Extract<TuiPart, { type: "image" }> => p.type === "image")
              .map((p) => ({ label: p.label }))
            return (
              <box marginBottom={1}>
                <UserMessage text={textPart().text} images={images()} status={props.message.userStatus} />
              </box>
            )
          }}
        </Show>
      }
    >
      {/* Assistant message — render all parts */}
      <box flexDirection="column">
        <Index each={displayItems()}>
          {(item) => (
            <Show
              when={item().type === "activity" ? item() as Extract<ToolActivityItem, { type: "activity" }> : undefined}
              fallback={
                <PartView
                  part={(item() as Extract<ToolActivityItem, { type: "part" }>).part}
                  onOpenFile={props.onOpenFile}
                />
              }
            >
              {(activity) => (
                <box marginBottom={1}>
                  <ToolActivity
                    kind={activity().kind}
                    tools={activity().tools}
                    continuingToolCallId={props.continuingToolCallId}
                  />
                </box>
              )}
            </Show>
          )}
        </Index>
      </box>
    </Show>
  )
}
