// Theme colors and style tokens for the Atom TUI
// Derived from Amp's dark-theme CLI aesthetic

export const colors = {
  // Primary accents
  primary: "cyan",
  success: "green",
  error: "red",
  warning: "yellow",
  muted: "gray",

  // Text
  text: "white",
  textDim: "gray",
  textBold: "white",

  // Borders
  border: "gray",
  borderActive: "cyan",
  borderSuccess: "green",

  // Message-specific
  userBar: "cyan",       // Left bar for user messages
  toolPath: "blue",      // File paths in tool results
  toolIcon: "green",     // Checkmark icon
  thinkingIcon: "green", // Thinking indicator

  // Status bar
  statusLine: "gray",
  statusModel: "yellow",
  statusSkills: "cyan",

  // Footer
  footerKey: "green",    // "Esc" highlighted
} as const

export type ColorName = keyof typeof colors

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
