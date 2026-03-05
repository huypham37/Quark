// Icon primitive — renders a styled unicode icon
import React from "react"
import { Text } from "ink"
import { icons, colors } from "../../theme"

type IconName = keyof typeof icons

interface IconProps {
  name: IconName
  color?: string
}

export function Icon({ name, color }: IconProps) {
  return <Text color={color}>{icons[name]}</Text>
}

// Shorthand components for common icons
export function Checkmark() {
  return <Icon name="checkmark" color={colors.success} />
}

export function Cross() {
  return <Icon name="cross" color={colors.error} />
}

export function Spinner() {
  return <Icon name="spinner" color={colors.primary} />
}

export function Dot() {
  return <Icon name="dot" color={colors.muted} />
}

export function Arrow() {
  return <Icon name="arrow" color={colors.muted} />
}
