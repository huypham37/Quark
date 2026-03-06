// Tests for autocomplete dropdown background — verifies that the dropdown
// renders with a solid background color that matches the terminal background,
// preventing text bleed-through from underlying content.

import { describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { colors } from "../../src/tui/theme"

describe("autocomplete dropdown background", () => {
  test("theme has a dropdownBg color defined", () => {
    expect(colors.dropdownBg).toBeDefined()
    expect(colors.dropdownBg).toBeInstanceOf(RGBA)
  })

  test("dropdownBg is a fully opaque color", () => {
    // The background must be fully opaque to prevent text bleed-through
    const bg = colors.dropdownBg
    // RGBA uses 0–1 float range
    expect(bg.a).toBe(1)
  })

  test("dropdownBg is a dark color suitable for a dark terminal theme", () => {
    // The dropdown bg should be dark (close to the terminal background)
    // but slightly distinct so it's visible as an overlay
    const bg = colors.dropdownBg
    // RGBA uses 0–1 float range; dark means values under ~0.3
    expect(bg.r).toBeLessThan(0.3)
    expect(bg.g).toBeLessThan(0.3)
    expect(bg.b).toBeLessThan(0.3)
  })
})
