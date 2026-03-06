// Theme colors and style tokens for the Atom TUI
// Derived from Amp's dark-theme CLI aesthetic
//
// Uses RGBA.fromHex() for optimal performance — avoids re-parsing color
// strings on every render. OpenTUI accepts both string and RGBA for `fg`/`bg`,
// but pre-parsed RGBA skips the internal parseColor() call.

import { RGBA } from "@opentui/core"
import type { ColorInput } from "@opentui/core"

export const colors = {
  // Primary accents
  primary: RGBA.fromHex("#00d7d7"),    // cyan
  success: RGBA.fromHex("#00d75f"),    // green
  error: RGBA.fromHex("#ff5f5f"),      // red
  warning: RGBA.fromHex("#d7d700"),    // yellow
  muted: RGBA.fromHex("#808080"),      // gray

  // Text
  text: RGBA.fromHex("#e4e4e4"),       // white
  textDim: RGBA.fromHex("#808080"),    // gray
  textBold: RGBA.fromHex("#ffffff"),   // bright white

  // Borders
  border: RGBA.fromHex("#808080"),     // gray
  borderActive: RGBA.fromHex("#00d7d7"), // cyan
  borderSuccess: RGBA.fromHex("#00d75f"), // green

  // Message-specific
  userBar: RGBA.fromHex("#00d7d7"),    // Left bar for user messages
  toolPath: RGBA.fromHex("#5f87ff"),   // File paths in tool results
  toolIcon: RGBA.fromHex("#00d75f"),   // Checkmark icon
  thinkingIcon: RGBA.fromHex("#00d75f"), // Thinking indicator

  // Status bar
  statusLine: RGBA.fromHex("#808080"), // gray
  statusModel: RGBA.fromHex("#d7d700"), // yellow
  statusSkills: RGBA.fromHex("#00d7d7"), // cyan

  // Footer
  footerKey: RGBA.fromHex("#00d75f"),  // "Esc" highlighted

  // Dropdown / autocomplete overlay
  dropdownBg: RGBA.fromHex("#1a1a2e"),       // dark bg for dropdown menus

  // Scrollbar
  scrollbarTrack: RGBA.fromHex("#3a3a3a"),   // dark gray track
  scrollbarThumb: RGBA.fromHex("#666666"),   // lighter gray thumb

  // Input cursor
  cursorColor: RGBA.fromHex("#00d7d7"),      // cyan blinking cursor
} as const

export type ColorName = keyof typeof colors

// Re-export ColorInput for components that accept color props
export type { ColorInput }

// Unicode icons used in the TUI
export const icons = {
  checkmark: "✓",
  cross: "✗",
  spinner: "⇄",
  dot: "·",
  arrow: "▶",
  treeCorner: "└──",
  treePipe: "│",
  treeTee: "├──",
  bullet: "•",
} as const
