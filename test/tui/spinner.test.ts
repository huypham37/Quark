// Tests for braille spinner frames used in footer-bar animation

import { describe, test, expect } from "bun:test"
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../../src/tui/spinner"

describe("braille spinner", () => {
  test("has at least 4 frames for smooth animation", () => {
    expect(SPINNER_FRAMES.length).toBeGreaterThanOrEqual(4)
  })

  test("each frame is a single character", () => {
    for (const frame of SPINNER_FRAMES) {
      expect([...frame]).toHaveLength(1)
    }
  })

  test("all frames are braille Unicode characters (U+2800–U+28FF)", () => {
    for (const frame of SPINNER_FRAMES) {
      const code = frame.codePointAt(0)!
      expect(code).toBeGreaterThanOrEqual(0x2800)
      expect(code).toBeLessThanOrEqual(0x28ff)
    }
  })

  test("interval is between 50ms and 150ms for smooth animation", () => {
    expect(SPINNER_INTERVAL_MS).toBeGreaterThanOrEqual(50)
    expect(SPINNER_INTERVAL_MS).toBeLessThanOrEqual(150)
  })
})
