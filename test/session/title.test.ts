import { describe, expect, test } from "bun:test"
import { buildTitlePrompt, validateTitle } from "../../packages/runner/src/session/title"

describe("session title generation", () => {
  test("interpolates a truncated user message into the title prompt source", () => {
    const message = "a".repeat(501)
    const prompt = buildTitlePrompt(message)

    expect(prompt).toContain(`User: ${"a".repeat(500)}`)
    expect(prompt).not.toContain(`User: ${message}`)
    expect(prompt).not.toContain("{{message}}")
  })

  test("cleans valid generated titles and rejects invalid ones", () => {
    expect(validateTitle('  "API Authentication"  ')).toBe("API Authentication")
    expect(validateTitle("")).toBeNull()
    expect(validateTitle("a".repeat(80))).toBeNull()
  })
})
