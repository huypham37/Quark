import { describe, expect, test } from "bun:test"
import { buildEditorArgv, displayFileTarget, parseFileUri, resolveEditor } from "../../src/tui/editor"

describe("file-link editor helpers", () => {
  test("parses local file URIs and source locations", () => {
    expect(parseFileUri("file:///tmp/a%20file.ts#L42C7")).toEqual({ filePath: "/tmp/a file.ts", line: 42, column: 7 })
    expect(parseFileUri("file://localhost/tmp/a.ts#L2-L9")).toEqual({ filePath: "/tmp/a.ts", line: 2 })
    expect(parseFileUri("https://example.com/a.ts")).toBeNull()
    expect(parseFileUri("file://server/tmp/a.ts")).toBeNull()
  })

  test("builds shell-free editor arguments", () => {
    const target = { filePath: "/tmp/a file.ts", line: 42, column: 7 }
    expect(buildEditorArgv("nvim", target)).toEqual(["nvim", "+42", "--", "/tmp/a file.ts"])
    expect(buildEditorArgv("code", target)).toEqual(["code", "--goto", "/tmp/a file.ts:42:7"])
    expect(buildEditorArgv("emacs", target)).toEqual(["emacs", "/tmp/a file.ts"])
  })

  test("uses config editor before environment and formats a concise path", () => {
    const priorEditor = process.env.EDITOR
    const priorVisual = process.env.VISUAL
    process.env.EDITOR = "vim"
    process.env.VISUAL = "code"
    expect(resolveEditor("helix")).toBe("helix")
    expect(resolveEditor()).toBe("vim")
    expect(displayFileTarget({ filePath: "/workspace/src/file.ts", line: 2 }, "/workspace")).toBe("src/file.ts:2")
    process.env.EDITOR = priorEditor
    process.env.VISUAL = priorVisual
  })
})
