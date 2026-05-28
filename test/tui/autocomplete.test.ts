// Tests for autocomplete dropdown background — verifies that the dropdown
// renders with a solid background color that matches the terminal background,
// preventing text bleed-through from underlying content.

import { beforeEach, describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { activeTheme, applyTheme, colors, setTerminalBg } from "../../src/tui/theme"
import { darkTheme } from "../../src/tui/themes/dark"

describe("autocomplete dropdown background", () => {
  beforeEach(() => {
    applyTheme(darkTheme)
  })

  test("theme has a dropdownBg color defined", () => {
    expect(colors.dropdownBg).toBeDefined()
    expect(colors.dropdownBg).toBeInstanceOf(RGBA)
  })

  test("dropdownBg is a fully opaque color", () => {
    const bg = colors.dropdownBg
    expect(bg.a).toBe(1)
  })

  test("default dark dropdownBg matches the dark background fallback", () => {
    const expected = RGBA.fromHex("#21252A")
    expect(colors.dropdownBg.r).toBeCloseTo(expected.r, 2)
    expect(colors.dropdownBg.g).toBeCloseTo(expected.g, 2)
    expect(colors.dropdownBg.b).toBeCloseTo(expected.b, 2)
  })

  test("setTerminalBg keeps dropdownBg matched to detected terminal color", () => {
    const detected = RGBA.fromHex("#2b2b3c")
    setTerminalBg(detected)
    expect(colors.dropdownBg).toBe(detected)
    expect(activeTheme.name).toBe("dark")
  })

  test("setTerminalBg updated color is fully opaque", () => {
    const detected = RGBA.fromHex("#1c1c1c")
    setTerminalBg(detected)
    expect(colors.dropdownBg.a).toBe(1)
  })

  test("setTerminalBg still applies the light theme for light backgrounds", () => {
    const detected = RGBA.fromHex("#ffffff")
    setTerminalBg(detected)
    expect(colors.dropdownBg).toBe(detected)
    expect(activeTheme.name).toBe("light")
  })
})
