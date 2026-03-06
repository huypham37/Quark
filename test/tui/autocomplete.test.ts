// Tests for autocomplete dropdown background — verifies that the dropdown
// renders with a solid background color that matches the terminal background,
// preventing text bleed-through from underlying content.

import { describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { colors, setTerminalBg } from "../../src/tui/theme"

describe("autocomplete dropdown background", () => {
  test("theme has a dropdownBg color defined", () => {
    expect(colors.dropdownBg).toBeDefined()
    expect(colors.dropdownBg).toBeInstanceOf(RGBA)
  })

  test("dropdownBg is a fully opaque color", () => {
    const bg = colors.dropdownBg
    expect(bg.a).toBe(1)
  })

  test("default dropdownBg is a dark color", () => {
    const bg = colors.dropdownBg
    expect(bg.r).toBeLessThan(0.3)
    expect(bg.g).toBeLessThan(0.3)
    expect(bg.b).toBeLessThan(0.3)
  })

  test("setTerminalBg updates dropdownBg to match detected terminal color", () => {
    const detected = RGBA.fromHex("#2b2b3c")
    setTerminalBg(detected)
    expect(colors.dropdownBg).toBe(detected)
  })

  test("setTerminalBg updated color is fully opaque", () => {
    const detected = RGBA.fromHex("#1c1c1c")
    setTerminalBg(detected)
    expect(colors.dropdownBg.a).toBe(1)
  })
})
