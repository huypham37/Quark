// @jsxImportSource @opentui/solid
// Notifications — floating panel for transient notifications (top-right)
//
// Shows notifications that auto-dismiss after a configurable duration.
// Styled similar to LazyVim's notification system.

import type { Component } from "solid-js"
import { For, createSignal, onMount, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import {
  type Notification,
  onNotify,
  onDismiss,
  getActive,
} from "../../notification/notification"
import { colors } from "../theme"

const MAX_VISIBLE = 3
const PANEL_WIDTH = 50

export const Notifications: Component = () => {
  const dims = useTerminalDimensions()
  const [notifications, setNotifications] = createSignal<Notification[]>([])

  onMount(() => {
    // Load any existing notifications
    setNotifications(getActive())

    // Subscribe to new notifications
    const unsubNotify = onNotify((n) => {
      setNotifications((prev) => [...prev, n].slice(-MAX_VISIBLE))
    })

    // Subscribe to dismissals
    const unsubDismiss = onDismiss((id) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    })

    onCleanup(() => {
      unsubNotify()
      unsubDismiss()
    })
  })

  const getIcon = (type: Notification["type"]): string => {
    switch (type) {
      case "error": return "✗"
      case "warn": return "⚠"
      case "info": return "ℹ"
    }
  }

  const getColor = (type: Notification["type"]): RGBA => {
    switch (type) {
      case "error": return colors.error
      case "warn": return colors.warning
      case "info": return colors.primary // cyan for info
    }
  }

  // Position at top-right, overlaying the main content
  const panelStyle = () => ({
    position: "absolute" as const,
    top: 1,
    right: 2,
    width: Math.min(PANEL_WIDTH, dims().width - 4),
  })

  return (
    <Show when={notifications().length > 0}>
      <box {...panelStyle()} flexDirection="column" gap={1}>
        <For each={notifications()}>
          {(n) => (
            <box
              flexDirection="column"
              paddingX={1}
              paddingY={0}
              borderStyle="round"
              borderColor={getColor(n.type)}
            >
              {/* Header: icon + title */}
              <box>
                <text fg={getColor(n.type)} bold>{getIcon(n.type)} </text>
                <text fg={getColor(n.type)} bold>{n.title}</text>
              </box>
              {/* Message body */}
              <text fg={colors.textDim} wrap="wrap">{n.message}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
