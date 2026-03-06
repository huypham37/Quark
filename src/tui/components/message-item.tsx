// @jsxImportSource @opentui/solid
// MessageItem — renders a single message (user or assistant) with all its parts
//
// Dispatches to the appropriate sub-component based on part type:
// - text → AssistantMessage (or UserMessage for user role)
// - tool → ToolResultLine (completed/error) or ToolInvocationBlock (running)
// - thinking → ThinkingIndicator

import type { Component } from "solid-js"
import { Show, Switch, Match, For } from "solid-js"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"
import { ToolResultLine } from "./tool-result"
import { ToolInvocationBlock } from "./tool-invocation"
import { ThinkingIndicator } from "./thinking"
import type { TuiMessage, TuiPart } from "../state"

interface MessageItemProps {
  message: TuiMessage
}

// Extract a description for tool invocation display
function getToolDescription(tool: string, input: Record<string, unknown>): string {
  if (tool === "bash") {
    const cmd = input.command ?? input.cmd
    if (typeof cmd === "string") return cmd
  }

  if (tool === "skill") {
    const desc = input.description
    if (typeof desc === "string") return desc
  }

  return JSON.stringify(input, null, 2)
}

const PartView: Component<{ part: TuiPart; isStreaming: boolean }> = (props) => {
  return (
    <Switch>
      <Match when={props.part.type === "text" && props.part}>
        {(part) => (
          <box marginBottom={(part() as Extract<TuiPart, { type: "text" }>).streaming ? 0 : 1}>
            <AssistantMessage
              text={(part() as Extract<TuiPart, { type: "text" }>).text}
              streaming={(part() as Extract<TuiPart, { type: "text" }>).streaming}
            />
          </box>
        )}
      </Match>

      <Match when={props.part.type === "tool" && (props.part as Extract<TuiPart, { type: "tool" }>).status === "running" && (props.part as Extract<TuiPart, { type: "tool" }>).tool === "skill"}>
        <box marginBottom={1}>
          <ToolInvocationBlock
            tool={(props.part as Extract<TuiPart, { type: "tool" }>).tool}
            description={getToolDescription(
              (props.part as Extract<TuiPart, { type: "tool" }>).tool,
              (props.part as Extract<TuiPart, { type: "tool" }>).input,
            )}
          />
        </box>
      </Match>

      <Match when={props.part.type === "tool" && (props.part as Extract<TuiPart, { type: "tool" }>).status === "running" && (props.part as Extract<TuiPart, { type: "tool" }>).tool === "bash"}>
        <box marginBottom={1}>
          <ToolInvocationBlock
            tool={(props.part as Extract<TuiPart, { type: "tool" }>).tool}
            description={getToolDescription(
              (props.part as Extract<TuiPart, { type: "tool" }>).tool,
              (props.part as Extract<TuiPart, { type: "tool" }>).input,
            )}
          />
        </box>
      </Match>

      <Match when={props.part.type === "tool"}>
        <box marginBottom={1}>
          <ToolResultLine
            tool={(props.part as Extract<TuiPart, { type: "tool" }>).tool}
            input={(props.part as Extract<TuiPart, { type: "tool" }>).input}
            status={(props.part as Extract<TuiPart, { type: "tool" }>).status}
            output={(props.part as Extract<TuiPart, { type: "tool" }>).output}
            error={(props.part as Extract<TuiPart, { type: "tool" }>).error}
          />
        </box>
      </Match>

      <Match when={props.part.type === "thinking"}>
        <box marginBottom={1}>
          <ThinkingIndicator done={(props.part as Extract<TuiPart, { type: "thinking" }>).done} />
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
        // User messages have a single text part
        <Show when={props.message.parts.find((p) => p.type === "text") as Extract<TuiPart, { type: "text" }> | undefined}>
          {(textPart) => (
            <box marginBottom={1}>
              <UserMessage text={textPart().text} />
            </box>
          )}
        </Show>
      }
    >
      {/* Assistant message — render all parts */}
      <box flexDirection="column" width="100%">
        <For each={props.message.parts}>
          {(part) => (
            <PartView part={part} isStreaming={!!props.message.streaming} />
          )}
        </For>
      </box>
    </Show>
  )
}
