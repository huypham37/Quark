// terminal-bg.ts — detect the terminal's background color via OSC 11 query
//
// Sends the OSC 11 escape sequence ("\x1b]11;?\x07") and parses the terminal's
// response to extract the background RGB color. Works on most modern terminals
// (iTerm2, Terminal.app, Kitty, Alacritty, WezTerm, Ghostty, etc.).
//
// Must be called BEFORE the TUI renderer takes over stdin/stdout.

import { RGBA } from "@opentui/core"

const DEFAULT_BG = RGBA.fromHex("#000000")
const TIMEOUT_MS = 150

/**
 * Query the terminal's background color using OSC 11.
 *
 * Returns the detected RGBA or a fallback (#000000) if the terminal
 * doesn't respond within TIMEOUT_MS.
 */
export function queryTerminalBackground(): Promise<RGBA> {
  return new Promise((resolve) => {
    let done = false
    let buf = ""

    const finish = (color: RGBA) => {
      if (done) return
      done = true
      process.stdin.removeListener("data", onData)
      // Restore stdin to non-raw, paused state so OpenTUI can set it up
      try {
        process.stdin.setRawMode(false)
      } catch { /* may not be a TTY in CI */ }
      process.stdin.pause()
      resolve(color)
    }

    const onData = (chunk: Buffer) => {
      buf += chunk.toString("latin1")

      // Look for OSC 11 response: \x1b]11;rgb:RRRR/GGGG/BBBB followed by BEL or ST
      const match = buf.match(/\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/)
      if (!match) return

      // Check for terminator (BEL \x07 or ST \x1b\\) after the match
      const afterMatch = buf.slice(buf.indexOf(match[0]) + match[0].length)
      if (!afterMatch.includes("\x07") && !afterMatch.includes("\x1b\\")) return

      const r = normalizeChannel(match[1]!)
      const g = normalizeChannel(match[2]!)
      const b = normalizeChannel(match[3]!)

      finish(RGBA.fromInts(r, g, b, 255))
    }

    // Set up raw stdin to receive the terminal's response
    try {
      process.stdin.setRawMode(true)
    } catch {
      // Not a TTY (CI, piped input) — return fallback immediately
      finish(DEFAULT_BG)
      return
    }

    process.stdin.resume()
    process.stdin.on("data", onData)

    // Send the OSC 11 query
    process.stdout.write("\x1b]11;?\x07")

    // Timeout fallback
    setTimeout(() => finish(DEFAULT_BG), TIMEOUT_MS)
  })
}

/** Convert a 2-digit or 4-digit hex channel to 0–255 */
function normalizeChannel(hex: string): number {
  const value = parseInt(hex, 16)
  if (hex.length <= 2) return value          // already 0–255
  return Math.round((value / 65535) * 255)   // scale 16-bit → 8-bit
}
