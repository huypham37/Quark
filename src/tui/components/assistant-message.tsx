// @jsxImportSource @opentui/solid
// AssistantMessage — renders assistant text as formatted markdown
//
// Uses OpenTUI's native <markdown> renderable which parses and renders
// markdown (headers, code blocks, lists, etc.) instead of
// <code filetype="markdown"> which only syntax-highlights the raw
// markdown source.
//
// IMPORTANT: In SolidJS, the component body runs ONCE. Never do early returns
// based on reactive props — use <Show> instead, so the rendering path stays
// reactive and re-evaluates when props change.

import type { Component } from "solid-js"
import { Show } from "solid-js"
import { syntaxStyle } from "../syntax-theme"

interface AssistantMessageProps {
  text: string
  streaming?: boolean
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <Show when={props.text}>
      <box flexDirection="column" width="100%">
        <markdown content={props.text} syntaxStyle={syntaxStyle} streaming={props.streaming ?? false} />
      </box>
    </Show>
  )
}
