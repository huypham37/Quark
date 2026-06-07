// @jsxImportSource @opentui/solid
// Notifications — floating panel for transient notifications (top-right)
//
// Shows notifications that auto-dismiss after a configurable duration.
// Styled similar to LazyVim's notification system.

import type { Component } from "solid-js"
import { For, createSignal, onMount, onCleanup, Show } from "solid-js"
import { useTerminalDimensions, useTimeline } from "@opentui/solid"
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
const SLIDE_MS = 260

function slideDistance(width: number): number {
  return Math.max(1, width + 2)
}

type NotificationCardProps = {
  notification: Notification
  panelWidth: () => number
  pad: (s: string) => string
  getIcon: (type: Notification["type"]) => string
  getColor: (type: Notification["type"]) => RGBA
}

const NotificationCard: Component<NotificationCardProps> = (props) => {
  const slide = { x: slideDistance(props.panelWidth()) }
  const [offset, setOffset] = createSignal(Math.round(slide.x))
  const timeline = useTimeline({ duration: SLIDE_MS, loop: false })

  timeline.add(slide, {
    x: 0,
    duration: SLIDE_MS,
    ease: "outCirc",
    onUpdate(values) {
      setOffset(Math.max(0, Math.round(values.targets[0].x)))
    },
    onComplete() {
      setOffset(0)
    },
  })

  return (
    <box flexDirection="column" width={props.panelWidth()} backgroundColor={colors.notificationBg} marginLeft={offset()}>
      <box
        flexDirection="column"
        paddingX={1}
        paddingY={0}
        borderStyle="round"
        borderColor={props.getColor(props.notification.type)}
        backgroundColor={colors.notificationBg}
      >
        <text fg={props.getColor(props.notification.type)} bg={colors.notificationBg} bold>
          {props.pad(`${props.getIcon(props.notification.type)} ${props.notification.title}`)}
        </text>
        <text fg={colors.textDim} bg={colors.notificationBg} wrap="wrap">
          {props.pad(props.notification.message)}
        </text>
      </box>
    </box>
  )
}

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
    width: panelWidth(),
  })

  const panelWidth = () => Math.max(1, Math.min(PANEL_WIDTH, dims().width - 4))

  // Pad a string to fill the full content width so bg covers every cell.
  // Border (2) + paddingX 1 each side (2) = 4 cols consumed from panel width.
  const pad = (s: string) => {
    const w = panelWidth() - 4
    return s.length >= w ? s : s + " ".repeat(Math.max(0, w - s.length))
  }

  return (
    <Show when={notifications().length > 0}>
      <box {...panelStyle()} flexDirection="column" gap={1}>
        <For each={notifications()}>
          {(n) => (
            <NotificationCard
              notification={n}
              panelWidth={panelWidth}
              pad={pad}
              getIcon={getIcon}
              getColor={getColor}
            />
          )}
        </For>
      </box>
    </Show>
  )
}
