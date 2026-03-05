// Tests for write, edit, and todo tools

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import { writeTool } from "../../src/tool/write"
import { editTool } from "../../src/tool/edit"
import { replace } from "../../src/tool/edit"
import { todoTool } from "../../src/tool/todo"
import type { ToolContext } from "../../src/tool/tool"

// Shared test context
function makeCtx(): ToolContext {
  return {
    sessionId: "test-session",
    messageId: "test-msg",
    abort: new AbortController().signal,
    messages: [],
    async ask() {},
  }
}

// Temp directory for file operations
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-tool-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Write tool
// ---------------------------------------------------------------------------
describe("writeTool", () => {
  test("creates a new file", async () => {
    const filePath = path.join(tmpDir, "hello.txt")
    const result = await writeTool.execute(
      { path: filePath, content: "hello world\n" },
      makeCtx(),
    )
    expect(result.output).toContain("Created")
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello world\n")
    expect(result.metadata.existed).toBe(false)
  })

  test("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "deep.txt")
    const result = await writeTool.execute(
      { path: filePath, content: "deep content" },
      makeCtx(),
    )
    expect(result.output).toContain("Created")
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("deep content")
  })

  test("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "existing.txt")
    fs.writeFileSync(filePath, "old content")
    const result = await writeTool.execute(
      { path: filePath, content: "new content" },
      makeCtx(),
    )
    expect(result.output).toContain("Updated")
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new content")
    expect(result.metadata.existed).toBe(true)
  })

  test("reports correct line and byte counts", async () => {
    const filePath = path.join(tmpDir, "counts.txt")
    const content = "line1\nline2\nline3"
    const result = await writeTool.execute(
      { path: filePath, content },
      makeCtx(),
    )
    expect(result.metadata.lines).toBe(3)
    expect(result.metadata.bytes).toBe(Buffer.byteLength(content))
  })
})

// ---------------------------------------------------------------------------
// Edit tool — replace() function
// ---------------------------------------------------------------------------
describe("replace()", () => {
  test("exact match replace", () => {
    const result = replace("hello world", "world", "earth")
    expect(result).toBe("hello earth")
  })

  test("throws on identical old/new", () => {
    expect(() => replace("hello", "hello", "hello")).toThrow("identical")
  })

  test("throws when not found", () => {
    expect(() => replace("hello world", "xyz", "abc")).toThrow("not found")
  })

  test("throws on multiple matches (no replaceAll)", () => {
    // "foo" appears twice, exact match finds it but idx !== lastIdx
    // Falls through all strategies and should throw
    expect(() => replace("foo bar foo", "foo", "baz")).toThrow()
  })

  test("replaceAll replaces all occurrences", () => {
    const result = replace("foo bar foo", "foo", "baz", true)
    expect(result).toBe("baz bar baz")
  })

  test("line-trimmed matching ignores whitespace", () => {
    const content = "  function foo() {\n    return 1;\n  }"
    // Search with different indentation
    const result = replace(content, "function foo() {\nreturn 1;\n}", "function bar() {\nreturn 2;\n}")
    expect(result).toContain("bar")
  })

  test("multiline exact replacement", () => {
    const content = "line1\nline2\nline3\nline4"
    const result = replace(content, "line2\nline3", "replaced2\nreplaced3")
    expect(result).toBe("line1\nreplaced2\nreplaced3\nline4")
  })
})

// ---------------------------------------------------------------------------
// Edit tool — full tool
// ---------------------------------------------------------------------------
describe("editTool", () => {
  test("edits a file with exact match", async () => {
    const filePath = path.join(tmpDir, "edit-me.txt")
    fs.writeFileSync(filePath, "hello world\ngoodbye world\n")

    const result = await editTool.execute(
      { path: filePath, old: "hello world", new: "hello earth" },
      makeCtx(),
    )

    expect(result.output).toContain("Edit applied")
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello earth\ngoodbye world\n")
  })

  test("throws on non-existent file", async () => {
    const filePath = path.join(tmpDir, "nonexistent.txt")
    await expect(
      editTool.execute(
        { path: filePath, old: "x", new: "y" },
        makeCtx(),
      ),
    ).rejects.toThrow("not found")
  })

  test("throws on directory path", async () => {
    await expect(
      editTool.execute(
        { path: tmpDir, old: "x", new: "y" },
        makeCtx(),
      ),
    ).rejects.toThrow("directory")
  })

  test("replaceAll works through the tool", async () => {
    const filePath = path.join(tmpDir, "multi.txt")
    fs.writeFileSync(filePath, "foo bar foo baz foo")

    const result = await editTool.execute(
      { path: filePath, old: "foo", new: "qux", replaceAll: true },
      makeCtx(),
    )

    expect(result.output).toContain("Edit applied")
    expect(fs.readFileSync(filePath, "utf-8")).toBe("qux bar qux baz qux")
  })
})

// ---------------------------------------------------------------------------
// Todo tool
// ---------------------------------------------------------------------------
describe("todoTool", () => {
  let origCwd: string

  beforeEach(() => {
    origCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
  })

  test("list returns empty when no file", async () => {
    const result = await todoTool.execute(
      { action: "list" },
      makeCtx(),
    )
    expect(result.output).toContain("No tasks")
  })

  test("add creates a task", async () => {
    const result = await todoTool.execute(
      { action: "add", task: "Build the thing" },
      makeCtx(),
    )
    expect(result.output).toContain("Build the thing")

    // Verify file exists
    const content = fs.readFileSync(path.join(tmpDir, ".agent", "todo.md"), "utf-8")
    expect(content).toContain("- [ ] Build the thing")
  })

  test("list shows added tasks", async () => {
    await todoTool.execute({ action: "add", task: "Task A" }, makeCtx())
    await todoTool.execute({ action: "add", task: "Task B" }, makeCtx())

    const result = await todoTool.execute({ action: "list" }, makeCtx())
    expect(result.output).toContain("Task A")
    expect(result.output).toContain("Task B")
    expect(result.metadata.count).toBe(2)
  })

  test("complete marks a task as done", async () => {
    await todoTool.execute({ action: "add", task: "Do X" }, makeCtx())
    const result = await todoTool.execute(
      { action: "complete", task: "Do X" },
      makeCtx(),
    )
    expect(result.output).toContain("Completed")

    const content = fs.readFileSync(path.join(tmpDir, ".agent", "todo.md"), "utf-8")
    expect(content).toContain("- [x] Do X")
  })

  test("complete returns not found for missing task", async () => {
    await todoTool.execute({ action: "add", task: "Exists" }, makeCtx())
    const result = await todoTool.execute(
      { action: "complete", task: "Nope" },
      makeCtx(),
    )
    expect(result.output).toContain("Could not find")
  })

  test("add throws without task", async () => {
    await expect(
      todoTool.execute({ action: "add" }, makeCtx()),
    ).rejects.toThrow("task is required")
  })
})
