// Braille spinner frames for the "agent running" animation
//
// Uses Unicode braille characters (U+2800–U+28FF) which form a smooth
// rotating dot pattern within a single character cell.

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export const SPINNER_INTERVAL_MS = 80
