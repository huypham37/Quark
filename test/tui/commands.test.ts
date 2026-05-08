// Tests for filterCommands — slash command filtering logic

import { describe, test, expect } from "bun:test"
import { filterCommands, commands } from "../../src/tui/commands"

describe("filterCommands", () => {
  test("returns all commands when query is empty", () => {
    const result = filterCommands("")
    expect(result).toEqual(commands)
  })

  test("returns all commands when query is empty with default limit", () => {
    const result = filterCommands("", 15)
    expect(result.length).toBe(commands.length)
  })

  test("filters by prefix match", () => {
    const result = filterCommands("m")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("model")
  })

  test("filters by longer prefix", () => {
    const result = filterCommands("mod")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("model")
  })

  test("is case-insensitive", () => {
    const result = filterCommands("MODEL")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("model")
  })

  test("c prefix matches clear only", () => {
    const result = filterCommands("c")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("clear")
  })

  test("returns empty array when no commands match", () => {
    const result = filterCommands("zzz")
    expect(result).toEqual([])
  })

  test("respects limit parameter", () => {
    const result = filterCommands("", 2)
    expect(result.length).toBe(2)
  })

  test("returns exact match", () => {
    const result = filterCommands("help")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("help")
  })

  test("sessions command has usage hint", () => {
    const result = filterCommands("sessions")
    expect(result.length).toBe(1)
    expect(result[0]!.usage).toBe("[session-id]")
  })

  test("model command has usage hint", () => {
    const result = filterCommands("model")
    expect(result.length).toBe(1)
    expect(result[0]!.usage).toBe("<model-name>")
  })

  test("help command has no usage hint", () => {
    const result = filterCommands("help")
    expect(result[0]!.usage).toBeUndefined()
  })

  test("s prefix matches sessions, settings, and steer", () => {
    const result = filterCommands("s")
    expect(result.length).toBe(3)
    expect(result.map((c) => c.id)).toContain("sessions")
    expect(result.map((c) => c.id)).toContain("settings")
    expect(result.map((c) => c.id)).toContain("steer")
  })

  test("r prefix matches reload-config only", () => {
    const result = filterCommands("r")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("reload-config")
  })

  test("e prefix matches exit only", () => {
    const result = filterCommands("e")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("exit")
  })

  test("h prefix matches help only", () => {
    const result = filterCommands("h")
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe("help")
  })
})
