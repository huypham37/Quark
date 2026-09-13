import { For, Show } from "solid-js"
import { Markdown } from "./Markdown"
import { SubAgentCard } from "./SubAgentCard"
import { ToolActivity } from "./ToolActivity"
import { groupMessageParts } from "../message-parts"
import type { Message as MessageType, MessagePart } from "../types"

function Thinking(props: { part: Extract<MessagePart, { type: "thinking" }> }) {
  return (
    <details class="thinking">
      <summary>{props.part.done ? "Thought" : "Thinking…"}</summary>
      <p>{props.part.text}</p>
    </details>
  )
}

function Label(props: { message: MessageType }) {
  const time = () => props.message.timeCreated
    ? new Date(props.message.timeCreated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : ""
  return (
    <div classList={{ "message-label": true, "assistant-label": props.message.role === "assistant" }}>
      <Show when={props.message.role === "assistant"}><span class="quark-avatar">Q</span></Show>
      <span>{props.message.role === "assistant" ? "Quark" : "You"}</span>
      <Show when={time()}><span class="message-time">{time()}</span></Show>
    </div>
  )
}

export function Message(props: { message: MessageType }) {
  const userText = () => props.message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")

  return (
    <article class={`message ${props.message.role}-message`} data-status={props.message.status}>
      <Label message={props.message} />
      <Show when={props.message.role === "user"} fallback={
        <>
          <For each={groupMessageParts(props.message.parts)}>{(item) => {
            if (item.type === "tools") return <ToolActivity parts={item.parts} />
            const part = item.part
            if (part.type === "text") return <Markdown text={part.text} />
            if (part.type === "thinking") return <Thinking part={part} />
            if (part.type === "tool") return <SubAgentCard part={part} />
            return null
          }}</For>
          <Show when={props.message.streaming && props.message.parts.length === 0}>
            <div class="working-row" aria-label="Quark is working"><span /><span /><span /></div>
          </Show>
        </>
      }><p>{userText()}</p></Show>
    </article>
  )
}
