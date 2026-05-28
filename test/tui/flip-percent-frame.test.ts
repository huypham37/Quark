import { describe, expect, test } from "bun:test"
import {
  FLIP_BOTTOM_FRAME,
  FLIP_DONE_FRAME,
  FLIP_OLD_FRAME,
  FLIP_TOP_FRAME,
  flipPercentText,
  shouldAnimateTokenPercent,
  tokenPercentValue,
} from "../../src/tui/components/flip-percent-frame"

describe("flip percent frame helpers", () => {
  test("calculates rounded token percentage", () => {
    expect(tokenPercentValue(0, 0)).toBe(0)
    expect(tokenPercentValue(1260, 128000)).toBe(1)
    expect(tokenPercentValue(64000, 128000)).toBe(50)
  })

  test("animates only upward percentage changes", () => {
    expect(shouldAnimateTokenPercent(2, 3)).toBe(true)
    expect(shouldAnimateTokenPercent(3, 3)).toBe(false)
    expect(shouldAnimateTokenPercent(3, 0)).toBe(false)
  })

  test("rolls changed digits vertically", () => {
    expect(flipPercentText(42, 43, FLIP_OLD_FRAME)).toBe("42%")
    expect(flipPercentText(42, 43, FLIP_TOP_FRAME)).toBe("4²%")
    expect(flipPercentText(42, 43, FLIP_BOTTOM_FRAME)).toBe("4₃%")
    expect(flipPercentText(42, 43, FLIP_DONE_FRAME)).toBe("43%")
  })

  test("keeps transition width stable when digit count grows", () => {
    expect(flipPercentText(9, 10, FLIP_OLD_FRAME)).toBe(" 9%")
    expect(flipPercentText(9, 10, FLIP_TOP_FRAME)).toBe(" ⁹%")
    expect(flipPercentText(9, 10, FLIP_BOTTOM_FRAME)).toBe("₁₀%")
    expect(flipPercentText(9, 10, FLIP_DONE_FRAME)).toBe("10%")
  })
})
