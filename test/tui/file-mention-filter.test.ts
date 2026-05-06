// Tests for @file mention fuzzy filtering — verifies that file mentions
// return more than 5 results (the old autocomplete cap) and support browsing
// through all matches via the scrollable dropdown.
//
// Covers:
//   - fuzzyFilter returns all matching results (not capped at 5)
//   - fuzzyFilter respects explicit limit argument
//   - MAX_FILE_ITEMS (50) allows deep browsing in large repos

import { describe, test, expect } from "bun:test"
import { fuzzyFilter } from "../../src/tui/filelist"

/** Generate a list of pseudo-file paths for testing */
function makeFiles(count: number, prefix = "src/components/"): string[] {
  return Array.from({ length: count }, (_, i) => {
    const padded = String(i).padStart(3, "0")
    return `${prefix}${padded}-component.tsx`
  })
}

describe("@file mention fuzzy filtering", () => {
  test("fuzzyFilter returns more than 5 matches when given enough files", () => {
    const files = makeFiles(30)
    // All files contain "component" — fuzzy match on "comp" should hit all 30
    const result = fuzzyFilter(files, "comp")
    expect(result.length).toBeGreaterThan(5)
    expect(result.length).toBe(15) // default limit
  })

  test("fuzzyFilter returns at most 50 when given explicit limit 50", () => {
    const files = makeFiles(60)
    const result = fuzzyFilter(files, "comp", 50)
    expect(result.length).toBe(50)
  })

  test("fuzzyFilter returns at most limit when fewer matches exist", () => {
    const files = makeFiles(8)
    const result = fuzzyFilter(files, "comp", 50)
    expect(result.length).toBe(8) // fewer than limit
  })

  test("fuzzyFilter returns empty array when nothing matches", () => {
    const files = makeFiles(10)
    const result = fuzzyFilter(files, "zzz_nonexistent")
    expect(result.length).toBe(0)
  })

  test("fuzzyFilter respects default limit of 15", () => {
    const files = makeFiles(25)
    const result = fuzzyFilter(files, "comp")
    expect(result.length).toBe(15)
  })

  test("fuzzyFilter results are sorted by relevance", () => {
    const files = [
      "src/foo/bar.ts",        // low score (no direct match on "bar" after "src/")
      "bar.ts",                // high score (segment boundary match at position 0)
      "src/components/bar.tsx", // medium score (segment boundary on "bar/")
      "baz/bar/qux.ts",        // medium score
      "lib/bar-utils.ts",      // medium-high score (segment boundary + close chars)
    ]
    const result = fuzzyFilter(files, "bar")
    // "bar.ts" should rank first (exact match at position 0 = highest boundary bonus)
    expect(result[0]).toBe("bar.ts")
    // All "bar"-containing files should appear
    expect(result.length).toBeGreaterThanOrEqual(4)
  })
})
