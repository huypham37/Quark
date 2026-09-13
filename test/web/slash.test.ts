import { describe, expect, test } from "bun:test"
import { filterSlashCommands, slashCommands, slashQuery } from "../../web/src/slash"

describe("web slash commands", () => {
  test("treats only leading slash text as a command query", () => {
    expect(slashQuery("/")).toBe("")
    expect(slashQuery("/new")).toBe("new")
    expect(slashQuery("  /new")).toBe(null)
    expect(slashQuery("hello /new")).toBe(null)
    expect(slashQuery("")).toBe(null)
  })

  test("ignores anything after the first line", () => {
    expect(slashQuery("/new\nsome body text")).toBe("new")
  })

  test("returns every command for an empty query", () => {
    expect(filterSlashCommands("")).toEqual(slashCommands)
  })

  test("ranks prefix matches ahead of substring matches", () => {
    expect(filterSlashCommands("s").map((command) => command.id)).toEqual(["sessions", "help", "new", "clear", "undo", "export"])
    expect(filterSlashCommands("ex").map((command) => command.id)).toEqual(["export"])
  })

  test("matches against descriptions as a fallback", () => {
    expect(filterSlashCommands("markdown").map((command) => command.id)).toEqual(["export"])
  })

  test("returns nothing when no command matches", () => {
    expect(filterSlashCommands("zzz")).toEqual([])
  })
})
