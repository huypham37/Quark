// @jsxImportSource @opentui/solid
// MessageItem — renders a single message (user or assistant) with all its parts
//
// Dispatches to the appropriate sub-component based on part type:
// - text → AssistantMessage (or UserMessage for user role)
// - tool → ToolBox wrapping ToolResultContent / SubAgentView / running description
// - thinking → ThinkingIndicator

import type { Component } from "solid-js"
import { Show, Switch, Match, For } from "solid-js"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"
import { ToolBox } from "./tool-box"
import { ToolResultContent } from "./tool-result"
import { SubAgentView } from "./sub-agent-view"
import { ThinkingIndicator } from "./thinking"
import { colors } from "../theme"
import type { TuiMessage, TuiPart } from "../state"

interface MessageItemProps {
  message: TuiMessage
}

// Extract a description for tool invocation display (running tools)
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

      {/* Sub-agent: bash tool with subAgent state — ToolBox with flat tree inside */}
      <Match when={props.part.type === "tool" && asTool().subAgent}>
        <box marginBottom={1}>
          <ToolBox tool={asTool().tool} status={asTool().status}>
            <text fg={colors.textDim} wrap="wrap">{getToolDescription(asTool().tool, asTool().input)}</text>
            <SubAgentView subAgent={asTool().subAgent!} />
          </ToolBox>
        </box>
      </Match>

      {/* Running skill — ToolBox with description */}
      <Match when={props.part.type === "tool" && asTool().status === "running" && asTool().tool === "skill"}>
        <box marginBottom={1}>
          <ToolBox tool={asTool().tool} status="running">
            <text fg={colors.textDim} wrap="wrap">{getToolDescription(asTool().tool, asTool().input)}</text>
          </ToolBox>
        </box>
      </Match>

      {/* Running bash (no sub-agent) — ToolBox with command */}
      <Match when={props.part.type === "tool" && asTool().status === "running" && asTool().tool === "bash"}>
        <box marginBottom={1}>
          <ToolBox tool={asTool().tool} status="running">
            <text fg={colors.textDim} wrap="wrap">{getToolDescription(asTool().tool, asTool().input)}</text>
          </ToolBox>
        </box>
      </Match>

      {/* All other tool parts (completed, error, pending, running non-bash/skill) */}
      <Match when={props.part.type === "tool"}>
        <box marginBottom={1}>
          <ToolBox tool={asTool().tool} status={asTool().status}>
            <ToolResultContent
              tool={asTool().tool}
              input={asTool().input}
              status={asTool().status}
              output={asTool().output}
              error={asTool().error}
              diff={asTool().diff}
              streamingContent={asTool().streamingContent}
            />
          </ToolBox>
        </box>
      </Match>

      <Match when={props.part.type === "thinking"}>
        <box marginBottom={1}>
          <ThinkingIndicator
            done={(props.part as Extract<TuiPart, { type: "thinking" }>).done}
            text={(props.part as Extract<TuiPart, { type: "thinking" }>).text}
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
            <PartView part={part} isStreaming={!!props.message.streaming} />
          )}
        </For>
      </box>
    </Show>
  )
}
