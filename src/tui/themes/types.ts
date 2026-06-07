// Theme shape — every theme must provide the same UI palette keys plus a
// matching list of syntax-highlighting tokens.

import { RGBA, type ThemeTokenStyle } from "@opentui/core"

export type Palette = {
  // Primary accents
  primary: RGBA
  success: RGBA
  error: RGBA
  warning: RGBA
  info: RGBA
  muted: RGBA

  // Text
  text: RGBA
  textDim: RGBA
  textBold: RGBA

  // Borders
  border: RGBA
  outline: RGBA
  borderActive: RGBA
  borderSuccess: RGBA

  // Message-specific
  userBar: RGBA
  toolPath: RGBA
  toolIcon: RGBA
  thinkingIcon: RGBA

  // Status bar
  statusLine: RGBA
  statusModel: RGBA
  statusSkills: RGBA

  // Footer
  footerKey: RGBA

  // Overlays
  dropdownBg: RGBA
  commandCardBg: RGBA
  notificationBg: RGBA

  // Mention chips
  mentionChipBg: RGBA
  mentionChipFg: RGBA

  // Scrollbar
  scrollbarTrack: RGBA
  scrollbarThumb: RGBA

  // Input
  cursorColor: RGBA
}

export type Theme = {
  name: "dark" | "light"
  colors: Palette
  syntax: ThemeTokenStyle[]
}
