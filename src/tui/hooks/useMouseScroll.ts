// useMouseScroll — enables mouse wheel / trackpad scrolling in Ink
//
// Terminals don't send mouse events by default. This hook:
// 1. Enables SGR mouse reporting by writing escape sequences to stdout
// 2. Listens to raw stdin data for mouse wheel events
// 3. Calls onScroll("up") or onScroll("down") on wheel events
// 4. Cleans up (disables mouse reporting) on unmount and process exit
//
// SGR mouse protocol (DECSET 1000 + 1006):
//   Enable:  \x1b[?1000h\x1b[?1006h
//   Disable: \x1b[?1000l\x1b[?1006l
//   Events:  \x1b[<button;col;rowM  (press/scroll)
//            \x1b[<button;col;rowm  (release)
//   Wheel:   button 64 = scroll up, button 65 = scroll down
//
// Works on: macOS Terminal, iTerm2, Kitty, WezTerm, Alacritty, etc.

import { useEffect } from "react"
import { useStdout, useStdin } from "ink"

// Escape sequences for SGR extended mouse reporting
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h"
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1006l"

// SGR mouse event regex: \x1b[<button;col;row(M|m)
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g

interface UseMouseScrollOptions {
  /** Called on scroll up (wheel away from user / trackpad swipe up) */
  onScrollUp: () => void
  /** Called on scroll down (wheel toward user / trackpad swipe down) */
  onScrollDown: () => void
  /** Whether mouse scrolling is active (default: true) */
  isActive?: boolean
}

export function useMouseScroll({ onScrollUp, onScrollDown, isActive = true }: UseMouseScrollOptions) {
  const { stdout } = useStdout()
  const { stdin } = useStdin()

  useEffect(() => {
    if (!isActive || !stdout || !stdin) return

    // Enable mouse reporting
    stdout.write(ENABLE_MOUSE)

    // Parse raw stdin data for SGR mouse events
    const handler = (data: Buffer) => {
      const str = data.toString("utf-8")
      let match: RegExpExecArray | null

      // Reset lastIndex for global regex
      SGR_MOUSE_RE.lastIndex = 0

      while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
        const button = parseInt(match[1]!, 10)
        const eventType = match[4] // M = press/scroll, m = release

        // Only handle press events (M), not release (m)
        if (eventType !== "M") continue

        if (button === 65) {
          // Scroll down (wheel toward user)
          onScrollDown()
        } else if (button === 64) {
          // Scroll up (wheel away from user)
          onScrollUp()
        }
      }
    }

    stdin.on("data", handler)

    // Cleanup function
    const cleanup = () => {
      stdin.off("data", handler)
      // Disable mouse reporting — restore terminal state
      try {
        stdout.write(DISABLE_MOUSE)
      } catch {
        // stdout may already be closed on exit
      }
    }

    // Also clean up on process exit to ensure terminal is restored
    const exitHandler = () => {
      cleanup()
    }
    process.on("exit", exitHandler)
    process.on("SIGINT", exitHandler)
    process.on("SIGTERM", exitHandler)

    return () => {
      cleanup()
      process.off("exit", exitHandler)
      process.off("SIGINT", exitHandler)
      process.off("SIGTERM", exitHandler)
    }
  }, [isActive, stdout, stdin, onScrollUp, onScrollDown])
}
