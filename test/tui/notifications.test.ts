// Tests for notification background — verifies that notifications render
// with a solid, opaque, dark background color that prevents text bleed-through
// from underlying content.

import { beforeEach, describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { applyTheme, colors, setTerminalBg } from "../../src/tui/theme"
import { darkTheme } from "../../src/tui/themes/dark"

describe("notification background", () => {
  beforeEach(() => {
    applyTheme(darkTheme)
  })

  test("theme has a notificationBg color defined", () => {
    expect(colors.notificationBg).toBeDefined()
    expect(colors.notificationBg).toBeInstanceOf(RGBA)
  })

  test("notificationBg is a fully opaque color", () => {
    const bg = colors.notificationBg
    expect(bg.a).toBe(1)
  })

  test("notificationBg is a dark color", () => {
    const bg = colors.notificationBg
    // All RGB channels should be < 0.3 to ensure solid dark background
    expect(bg.r).toBeLessThan(0.3)
    expect(bg.g).toBeLessThan(0.3)
    expect(bg.b).toBeLessThan(0.3)
  })

  test("notificationBg is different from the text color", () => {
    const bg = colors.notificationBg
    const text = colors.text
    // At least one channel should be different to ensure contrast
    const isDifferent = 
      bg.r !== text.r || 
      bg.g !== text.g || 
      bg.b !== text.b
    expect(isDifferent).toBe(true)
  })

  test("setTerminalBg keeps notificationBg matched to detected terminal color", () => {
    const detected = RGBA.fromHex("#2b2b3c")
    setTerminalBg(detected)
    expect(colors.notificationBg).toBe(detected)
  })
})
