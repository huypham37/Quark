// @jsxImportSource @opentui/solid
// PermissionPrompt — renders when a tool needs user approval
//
// Shows the tool name, compact input JSON, and key hints.
// Key handling (a/o/r) is done in App.tsx's global keyboard handler.

import type { Component } from "solid-js"
import type { PermissionRequest } from "../state"
import { colors, icons } from "../theme"

export interface PermissionPromptProps {
  request: PermissionRequest
}

export const PermissionPrompt: Component<PermissionPromptProps> = (props) => {
  const shortInput = () => {
    const str = JSON.stringify(props.request.input, null, 2)
    return str.length > 200 ? str.slice(0, 200) + "..." : str
  }

  return (
    <box flexDirection="column">
      <box>
        <text fg={colors.warning}>{icons.dot} </text>
        <text bold>Allow </text>
        <text fg={colors.primary}>{props.request.tool}</text>
        <text>?</text>
      </box>
      <box marginLeft={2}>
        <text fg={colors.muted}>{shortInput()}</text>
      </box>
      <box marginTop={1}>
        <text fg={colors.footerKey} bold>(a)</text>
        <text> Always  </text>
        <text fg={colors.footerKey} bold>(o)</text>
        <text> Once  </text>
        <text fg={colors.error} bold>(r)</text>
        <text> Reject</text>
      </box>
    </box>
  )
}
