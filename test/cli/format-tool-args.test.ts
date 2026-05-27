import { describe, test, expect } from "bun:test"
import { formatArgs, formatValue } from "../../src/debug/format-tool-args"

describe("formatValue", () => {
  test("primitives", () => {
    expect(formatValue(null)).toBe("null")
    expect(formatValue(undefined)).toBe("undefined")
    expect(formatValue(42)).toBe("42")
    expect(formatValue(true)).toBe("true")
    expect(formatValue("hi")).toBe('"hi"')
  })

  test("truncates long strings with char count", () => {
    const s = "a".repeat(200)
    const out = formatValue(s)
    expect(out).toContain("…(200 chars)")
    // 120 chars + ellipsis suffix, all inside JSON quotes
    expect(out.startsWith('"')).toBe(true)
    expect(out.endsWith('"')).toBe(true)
  })

  test("collapses multi-line strings to first line + count", () => {
    const out = formatValue("first\nsecond\nthird")
    expect(out).toContain("first")
    expect(out).toContain("…(3 lines)")
    expect(out).not.toContain("second")
  })

  test("truncates arrays >5 items", () => {
    expect(formatValue([1, 2, 3, 4, 5, 6, 7])).toBe("[1, 2, 3, 4, 5, …(7)]")
  })

  test("short arrays kept intact", () => {
    expect(formatValue([1, 2])).toBe("[1, 2]")
  })

  test("nested objects render inline", () => {
    expect(formatValue({ a: 1, b: { c: 2 } })).toBe("{ a: 1, b: { c: 2 } }")
  })
})

describe("formatArgs", () => {
  test("redacts secret-like keys", () => {
    const out = formatArgs({ apiKey: "sk-12345", token: "t", password: "p", auth: "a", path: "/x" })
    expect(out).toContain('apiKey: "***"')
    expect(out).toContain('token: "***"')
    expect(out).toContain('password: "***"')
    expect(out).toContain('auth: "***"')
    expect(out).toContain('path: "/x"')
    expect(out).not.toContain("sk-12345")
  })

  test("redaction is case-insensitive", () => {
    expect(formatArgs({ ACCESS_TOKEN: "x" })).toContain('ACCESS_TOKEN: "***"')
  })

  test("renders typical read tool input", () => {
    const out = formatArgs({ path: "/tmp/foo.ts", read_range: [1, 100] })
    expect(out).toBe('{ path: "/tmp/foo.ts", read_range: [1, 100] }')
  })

  test("empty input", () => {
    expect(formatArgs({})).toBe("{  }")
  })
})
