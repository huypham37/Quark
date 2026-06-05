// @jsxImportSource @opentui/solid
// MessageItem — renders a single message (user or assistant) with all its parts
//
// Dispatches to the appropriate sub-component based on part type:
// - text → AssistantMessage (or UserMessage for user role)
// - tool → ToolCard (unified tool rendering)
// - thinking → ThinkingIndicator

import type { Component } from "solid-js"
import { Show, Switch, Match, For } from "solid-js"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"
import { ToolCard } from "./tool-card"
import { ThinkingIndicator } from "./thinking"
import { SubAgentView } from "./sub-agent-view"
import { colors } from "../theme"
import type { TuiMessage, TuiPart } from "../state"

interface MessageItemProps {
  message: TuiMessage
  showThinking?: boolean
}

const PartView: Component<{ part: TuiPart; isStreaming: boolean; showThinking?: boolean }> = (props) => {
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
            />
          </box>
        )}
      </Match>

      {/* Sub-agent: bash tool with subAgent state — render unified SubAgentView */}
      <Match when={props.part.type === "tool" && asTool().subAgent}>
        <box marginBottom={1}>
          <SubAgentView subAgent={asTool().subAgent!} parentStatus={asTool().status} />
        </box>
      </Match>

      {/* All other tools — ToolCard handles everything */}
      <Match when={props.part.type === "tool"}>
        <box marginBottom={1}>
          <ToolCard
            tool={asTool().tool}
            status={asTool().status}
            input={asTool().input}
            output={asTool().output}
            error={asTool().error}
            diff={asTool().diff}
            streamingContent={asTool().streamingContent}
          />
        </box>
      </Match>

      <Match when={props.part.type === "thinking"}>
        <box marginBottom={1}>
          <ThinkingIndicator
            done={(props.part as Extract<TuiPart, { type: "thinking" }>).done}
            text={(props.part as Extract<TuiPart, { type: "thinking" }>).text}
            showText={props.showThinking}
          />
        </box>
      </Match>
    </Switch>
  )
}

export const MessageItem: Component<MessageItemProps> = (props) => {
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
                <UserMessage text={textPart().text} images={images()} />
              </box>
            )
          }}
        </Show>
      }
    >
      {/* Assistant message — render all parts */}
      <box flexDirection="column" width="100%">
        <For each={props.message.parts}>
          {(part) => (
            <PartView part={part} isStreaming={!!props.message.streaming} showThinking={props.showThinking} />
          )}
        </For>
      </box>
    </Show>
  )
}
