// Tests for parseContextBlocks — verifies that @file mentions are path-only
// references (self-closing <file path="..." />) and never carry file content
// into the model context.

import { describe, test, expect } from "bun:test"
import { parseContextBlocks } from "../../src/tui/components/mention-context"

describe("parseContextBlocks — path-only file mentions", () => {
  test("parses self-closing <file> block as a path-only item with no content", () => {
    const text = 'check this\n<file path="src/foo.ts" />\n'
    const { cleaned, items } = parseContextBlocks(text)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: "file", path: "src/foo.ts" })
    expect(items[0]!.content).toBeUndefined()
    expect(cleaned).toBe("check this")
  })

  test("self-closing file block is stripped from the cleaned (displayed) text", () => {
    const text = 'look at\n<file path="img/logo.png" />\nplease'
    const { cleaned } = parseContextBlocks(text)
    expect(cleaned).not.toContain("<file")
    expect(cleaned).toContain("look at")
    expect(cleaned).toContain("please")
  })

  test("handles multiple path-only file mentions without duplicates", () => {
    const text = '<file path="a.ts" />\n<file path="b.ts" />\n<file path="a.ts" />'
    const { items } = parseContextBlocks(text)
    const files = items.filter((i) => i.type === "file")
    expect(files.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"])
  })

  test("still parses legacy <file> blocks that contain content", () => {
    const text = '<file path="legacy.ts">const x = 1</file>'
    const { items } = parseContextBlocks(text)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: "file", path: "legacy.ts", content: "const x = 1" })
  })
})
