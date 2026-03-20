// Tests for grep, glob, and websearch tools

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import { grepTool } from "../../src/tool/grep"
import { globTool } from "../../src/tool/glob"
import { websearchTool } from "../../src/tool/websearch"
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-search-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Grep tool
// ---------------------------------------------------------------------------
describe("grepTool", () => {
  test("finds pattern in files", async () => {
    // Create test files
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "function hello() {\n  return 'world';\n}")
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "const x = 1;\nconst hello = 2;")

    const result = await grepTool.execute(
      { pattern: "hello", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toContain("Found")
    expect(result.output).toContain("hello")
    expect(result.metadata.matches).toBeGreaterThan(0)
  })

  test("returns no files found for non-matching pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "nothing here")

    const result = await grepTool.execute(
      { pattern: "xyz123nonexistent", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toBe("No files found")
    expect(result.metadata.matches).toBe(0)
  })

  test("filters by include pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "code.ts"), "const foo = 1;")
    fs.writeFileSync(path.join(tmpDir, "code.js"), "const foo = 2;")
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "foo notes")

    const result = await grepTool.execute(
      { pattern: "foo", path: tmpDir, include: "*.ts" },
      makeCtx(),
    )

    expect(result.output).toContain("code.ts")
    expect(result.output).not.toContain("code.js")
    expect(result.output).not.toContain("notes.txt")
  })

  test("handles regex patterns", async () => {
    fs.writeFileSync(path.join(tmpDir, "regex.txt"), "foo123bar\nfoo456bar\nbaz")

    const result = await grepTool.execute(
      { pattern: "foo\\d+bar", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toContain("foo123bar")
    expect(result.output).toContain("foo456bar")
    expect(result.metadata.matches).toBe(2)
  })

  test("errors on non-existent directory", async () => {
    const result = await grepTool.execute(
      { pattern: "test", path: "/nonexistent/path/xyz" },
      makeCtx(),
    )

    expect(result.output).toContain("Error")
    expect(result.output).toContain("not found")
  })

  test("throws without pattern", async () => {
    await expect(
      grepTool.execute({ pattern: "" }, makeCtx()),
    ).rejects.toThrow("pattern is required")
  })
})

// ---------------------------------------------------------------------------
// Glob tool
// ---------------------------------------------------------------------------
describe("globTool", () => {
  test("finds files matching pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "")
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "")
    fs.writeFileSync(path.join(tmpDir, "c.js"), "")

    const result = await globTool.execute(
      { pattern: "*.ts", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toContain("a.ts")
    expect(result.output).toContain("b.ts")
    expect(result.output).not.toContain("c.js")
    expect(result.metadata.count).toBe(2)
  })

  test("finds files in nested directories", async () => {
    const nested = path.join(tmpDir, "src", "components")
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, "Button.tsx"), "")
    fs.writeFileSync(path.join(nested, "Input.tsx"), "")
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "")

    const result = await globTool.execute(
      { pattern: "**/*.tsx", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toContain("Button.tsx")
    expect(result.output).toContain("Input.tsx")
    expect(result.output).not.toContain("index.ts")
    expect(result.metadata.count).toBe(2)
  })

  test("returns no files found for non-matching pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "")

    const result = await globTool.execute(
      { pattern: "*.xyz", path: tmpDir },
      makeCtx(),
    )

    expect(result.output).toBe("No files found")
    expect(result.metadata.count).toBe(0)
  })

  test("errors on non-existent directory", async () => {
    const result = await globTool.execute(
      { pattern: "*.ts", path: "/nonexistent/path/xyz" },
      makeCtx(),
    )

    expect(result.output).toContain("Error")
    expect(result.output).toContain("not found")
  })

  test("throws without pattern", async () => {
    await expect(
      globTool.execute({ pattern: "" }, makeCtx()),
    ).rejects.toThrow("pattern is required")
  })

  test("sorts by modification time (newest first)", async () => {
    // Create files with different timestamps
    fs.writeFileSync(path.join(tmpDir, "old.ts"), "old")
    
    // Wait a bit to ensure different mtime
    await new Promise(resolve => setTimeout(resolve, 100))
    
    fs.writeFileSync(path.join(tmpDir, "new.ts"), "new")

    const result = await globTool.execute(
      { pattern: "*.ts", path: tmpDir },
      makeCtx(),
    )

    const lines = result.output.split("\n")
    const newIdx = lines.findIndex(l => l.includes("new.ts"))
    const oldIdx = lines.findIndex(l => l.includes("old.ts"))
    
    expect(newIdx).toBeLessThan(oldIdx)
  })
})

// ---------------------------------------------------------------------------
// Websearch tool
// ---------------------------------------------------------------------------
describe("websearchTool", () => {
  test("has correct tool definition", () => {
    expect(websearchTool.id).toBe("websearch")
    expect(websearchTool.description).toContain("Web search")
  })

  test("throws without query", async () => {
    await expect(
      websearchTool.execute({ query: "" }, makeCtx()),
    ).rejects.toThrow("query is required")
  })

  // Note: Live API test - may fail if network is unavailable or API is down
  test("performs actual web search", async () => {
    const result = await websearchTool.execute(
      { query: "TypeScript programming language", numResults: 3 },
      makeCtx(),
    )

    expect(result.title).toContain("TypeScript")
    // Either we get results or a "no results" message
    expect(result.output.length).toBeGreaterThan(0)
  }, 30000) // 30 second timeout for network request
})
