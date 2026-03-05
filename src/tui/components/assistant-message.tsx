// @jsxImportSource @opentui/solid
// AssistantMessage — renders assistant text with markdown
//
// Uses OpenTUI's native <code filetype="markdown"> for rendering.
//
// IMPORTANT: In SolidJS, the component body runs ONCE. Never do early returns
// based on reactive props — use <Show> instead, so the rendering path stays
// reactive and re-evaluates when props change.

import type { Component } from "solid-js"
import { Show } from "solid-js"

interface AssistantMessageProps {
  text: string
  streaming?: boolean
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <Show when={props.text}>
      <box flexDirection="column" width="100%">
        <code filetype="markdown" content={props.text} streaming={props.streaming ?? false} />
      </box>
    </Show>
  )
}
