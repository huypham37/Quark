// Theme colors and style tokens for the Quark TUI
// Unified theme system: dark + light palettes, auto-selected from the
// detected terminal background. Components keep importing `colors` —
// only its property values change when `applyTheme()` runs at startup.
//
// Uses RGBA from @opentui/core for pre-parsed colors (no parseColor() at
// render time). OpenTUI accepts both string and RGBA for `fg`/`bg`.

import { RGBA, SyntaxStyle } from "@opentui/core"
import type { ColorInput } from "@opentui/core"
import { darkTheme } from "./themes/dark"
import { lightTheme } from "./themes/light"
import type { Palette, Theme } from "./themes/types"

// Mutable singleton — components import this reference once and keep it.
// `applyTheme()` mutates the properties in-place so the live reference
// always reflects the active palette.
export const colors: Palette = { ...darkTheme.colors }

// SyntaxStyle is rebuilt on theme change; consumers read the live binding.
// Note: ES module `export let` provides live bindings to importers, so
// reassigning here propagates to `import { syntaxStyle }` call sites as
// long as the swap happens before they're evaluated (we apply theme at
// TUI startup, before the first render).
export let syntaxStyle: SyntaxStyle = SyntaxStyle.fromTheme(darkTheme.syntax)

export type ColorName = keyof Palette
export type { ColorInput, Theme }

/** Active theme metadata (mostly for debugging / future settings UI). */
export let activeTheme: Theme = darkTheme

/**
 * Swap the active theme. Mutates `colors` in place and rebuilds
 * `syntaxStyle`. Safe to call multiple times; intended to be called once
 * at TUI startup after detecting the terminal background.
 */
export function applyTheme(theme: Theme): void {
  Object.assign(colors, theme.colors)
  syntaxStyle = SyntaxStyle.fromTheme(theme.syntax)
  activeTheme = theme
}

/**
 * Pick dark or light theme from a terminal background color.
 * Uses ITU-R BT.601 luminance: L > 128 → light terminal.
 */
export function pickThemeFor(bg: RGBA): Theme {
  // RGBA from @opentui/core stores channels in 0..1 floats — scale to 0..255.
  const r = bg.r * 255
  const g = bg.g * 255
  const b = bg.b * 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 128 ? lightTheme : darkTheme
}

/**
 * Apply the readable theme for the detected terminal background, while
 * keeping panel backgrounds flush with the terminal itself.
 */
export function setTerminalBg(bg: RGBA): void {
  applyTheme(pickThemeFor(bg))
  colors.commandCardBg = bg
  colors.dropdownBg = bg
  colors.notificationBg = bg
}

// Unicode icons used in the TUI (not theme-dependent).
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
