// TDD tests (red phase) for code diff feature in TUI
// Tests pure utility functions for generating and parsing unified diffs

import { describe, test, expect } from "bun:test"
import type { TuiPart } from "../../src/tui/state"
import { generateUnifiedDiff, parseDiffHunks } from "../../src/shared/diff-utils"
import type { DiffLine, DiffHunk } from "../../src/shared/diff-utils"

// ---------------------------------------------------------------------------
// generateUnifiedDiff() tests
// ---------------------------------------------------------------------------

describe("generateUnifiedDiff", () => {
  test("returns empty string when contents are identical", () => {
    const content = "line 1\nline 2\nline 3"
    const result = generateUnifiedDiff(content, content, "test.txt")
    
    expect(result).toBe("")
  })

  test("returns empty string for two empty strings", () => {
    const result = generateUnifiedDiff("", "", "test.txt")
    
    expect(result).toBe("")
  })

  test("generates diff with file headers when contents differ", () => {
    const oldContent = "line 1\nline 2"
    const newContent = "line 1\nline 2 modified"
    
    const result = generateUnifiedDiff(oldContent, newContent, "example.js")
    
    expect(result).toContain("--- a/example.js")
    expect(result).toContain("+++ b/example.js")
  })

  test("marks added lines with '+' prefix", () => {
    const oldContent = "line 1\nline 2"
    const newContent = "line 1\nline 2\nline 3"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("+line 3")
  })

  test("marks removed lines with '-' prefix", () => {
    const oldContent = "line 1\nline 2\nline 3"
    const newContent = "line 1\nline 3"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("-line 2")
  })

  test("includes context lines with space prefix", () => {
    const oldContent = "context\nold line\ncontext"
    const newContent = "context\nnew line\ncontext"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain(" context")
  })

  test("generates hunk header with line numbers", () => {
    const oldContent = "line 1\nline 2"
    const newContent = "line 1\nmodified"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    // Hunk header format: @@ -oldStart,oldCount +newStart,newCount @@
    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
  })

  test("handles new file (empty oldContent) by showing all lines as added", () => {
    const oldContent = ""
    const newContent = "new line 1\nnew line 2"
    
    const result = generateUnifiedDiff(oldContent, newContent, "new-file.txt")
    
    expect(result).toContain("--- /dev/null")
    expect(result).toContain("+++ b/new-file.txt")
    expect(result).toContain("+new line 1")
    expect(result).toContain("+new line 2")
  })

  test("handles deleted file (empty newContent) by showing all lines as removed", () => {
    const oldContent = "old line 1\nold line 2"
    const newContent = ""
    
    const result = generateUnifiedDiff(oldContent, newContent, "deleted.txt")
    
    expect(result).toContain("--- a/deleted.txt")
    expect(result).toContain("+++ /dev/null")
    expect(result).toContain("-old line 1")
    expect(result).toContain("-old line 2")
  })

  test("handles multiple separate change hunks", () => {
    const oldContent = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10"
    const newContent = "line 1 modified\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9 modified\nline 10"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    // Should have 2 hunk headers for 2 separate changes
    const hunkMatches = result.match(/@@ -\d+,\d+ \+\d+,\d+ @@/g)
    expect(hunkMatches).toBeTruthy()
    expect(hunkMatches!.length).toBeGreaterThanOrEqual(2)
  })

  test("handles content with no trailing newline", () => {
    const oldContent = "line 1\nline 2"
    const newContent = "line 1\nline 2\nline 3" // no trailing newline
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("+line 3")
  })

  test("preserves empty lines in diff output", () => {
    const oldContent = "line 1\n\nline 3"
    const newContent = "line 1\n\nline 3 modified"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    // Empty line should appear as context
    const lines = result.split("\n")
    expect(lines.some(line => line === " ")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseDiffHunks() tests
// ---------------------------------------------------------------------------

describe("parseDiffHunks", () => {
  test("returns empty array for empty string", () => {
    const result = parseDiffHunks("")
    
    expect(result).toEqual([])
  })

  test("returns empty array for non-diff content", () => {
    const result = parseDiffHunks("just some text\nno diff here")
    
    expect(result).toEqual([])
  })

  test("parses single hunk with added lines", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,3 @@
 line 1
 line 2
+line 3`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].oldStart).toBe(1)
    expect(result[0].oldLines).toBe(2)
    expect(result[0].newStart).toBe(1)
    expect(result[0].newLines).toBe(3)
    expect(result[0].lines).toHaveLength(3)
  })

  test("correctly identifies line types (context, added, removed)", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3`
    
    const result = parseDiffHunks(diff)
    
    expect(result[0].lines[0].type).toBe("context")
    expect(result[0].lines[0].content).toBe("line 1")
    
    expect(result[0].lines[1].type).toBe("removed")
    expect(result[0].lines[1].content).toBe("line 2")
    
    expect(result[0].lines[2].type).toBe("added")
    expect(result[0].lines[2].content).toBe("line 2 modified")
    
    expect(result[0].lines[3].type).toBe("context")
    expect(result[0].lines[3].content).toBe("line 3")
  })

  test("parses multiple hunks in same diff", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,2 @@
-old line 1
+new line 1
 context
@@ -5,2 +5,2 @@
 context
-old line 5
+new line 5`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(2)
    expect(result[0].oldStart).toBe(1)
    expect(result[1].oldStart).toBe(5)
  })

  test("handles hunk with only additions", () => {
    const diff = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+line 1
+line 2`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].oldStart).toBe(0)
    expect(result[0].oldLines).toBe(0)
    expect(result[0].newStart).toBe(1)
    expect(result[0].newLines).toBe(2)
    expect(result[0].lines.every(line => line.type === "added")).toBe(true)
  })

  test("handles hunk with only deletions", () => {
    const diff = `--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line 1
-line 2`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].oldStart).toBe(1)
    expect(result[0].oldLines).toBe(2)
    expect(result[0].newStart).toBe(0)
    expect(result[0].newLines).toBe(0)
    expect(result[0].lines.every(line => line.type === "removed")).toBe(true)
  })

  test("assigns correct line numbers to diff lines", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -2,3 +2,3 @@
 context
-removed
+added
 context`
    
    const result = parseDiffHunks(diff)
    const lines = result[0].lines
    
    // Context line at old line 2, new line 2
    expect(lines[0].oldLineNo).toBe(2)
    expect(lines[0].newLineNo).toBe(2)
    
    // Removed line at old line 3, no new line number
    expect(lines[1].oldLineNo).toBe(3)
    expect(lines[1].newLineNo).toBeUndefined()
    
    // Added line has no old line number, new line 3
    expect(lines[2].oldLineNo).toBeUndefined()
    expect(lines[2].newLineNo).toBe(3)
    
    // Context line at old line 4, new line 4
    expect(lines[3].oldLineNo).toBe(4)
    expect(lines[3].newLineNo).toBe(4)
  })

  test("handles empty lines in diff hunks", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
 
-line 3`
    
    const result = parseDiffHunks(diff)
    
    expect(result[0].lines[1].type).toBe("context")
    expect(result[0].lines[1].content).toBe("")
  })

  test("ignores metadata lines outside hunks", () => {
    const diff = `diff --git a/test.txt b/test.txt
index abc123..def456 100644
--- a/test.txt
+++ b/test.txt
@@ -1,1 +1,1 @@
-old
+new`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].lines).toHaveLength(2)
  })

  test("handles hunk header with function context", () => {
    // Some diff formats include function name after hunk header
    const diff = `--- a/test.js
+++ b/test.js
@@ -10,3 +10,4 @@ function example() {
 context
-old line
+new line
+another new line`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].oldStart).toBe(10)
    expect(result[0].lines).toHaveLength(4)
  })

  test("handles single-line count in hunk header", () => {
    // When count is 1, it can be omitted: @@ -1 +1,2 @@
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1 +1,2 @@
-old
+new line 1
+new line 2`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].oldStart).toBe(1)
    expect(result[0].oldLines).toBe(1)
    expect(result[0].newLines).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Type integration test - verify TuiPart can have diff field
// ---------------------------------------------------------------------------

describe("TuiPart type integration", () => {
  test("tool part type supports optional diff field", () => {
    const toolPart: TuiPart = {
      type: "tool",
      tool: "write",
      callId: "call-123",
      status: "completed",
      input: { filePath: "test.ts", content: "new content" },
      output: "File written",
      diff: "--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-old\n+new"
    }
    
    expect(toolPart.type).toBe("tool")
  })

  test("diff field should be optional in tool part", () => {
    const toolPartWithoutDiff: TuiPart = {
      type: "tool",
      tool: "read",
      callId: "call-456",
      status: "completed",
      input: { path: "test.ts" },
      output: "file content"
    }
    
    expect(toolPartWithoutDiff.type).toBe("tool")
    expect((toolPartWithoutDiff as any).diff).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Edge cases and error handling
// ---------------------------------------------------------------------------

describe("generateUnifiedDiff edge cases", () => {
  test("handles very long lines without breaking", () => {
    const longLine = "x".repeat(10000)
    const oldContent = `short line\n${longLine}`
    const newContent = `short line\n${longLine} modified`
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toBeTruthy()
    expect(result).toContain("-" + longLine)
    expect(result).toContain("+" + longLine + " modified")
  })

  test("handles special characters in content", () => {
    const oldContent = "line with\ttabs\nline with 'quotes'\nline with \"double quotes\""
    const newContent = "line with\ttabs modified\nline with 'quotes'\nline with \"double quotes\""
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("\t")
    expect(result).toContain("'")
    expect(result).toContain('"')
  })

  test("handles unicode characters correctly", () => {
    const oldContent = "Hello 世界\nEmoji: 🚀"
    const newContent = "Hello 世界 modified\nEmoji: 🚀"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("世界")
    expect(result).toContain("🚀")
  })

  test("handles Windows line endings (CRLF)", () => {
    const oldContent = "line 1\r\nline 2\r\nline 3"
    const newContent = "line 1\r\nline 2 modified\r\nline 3"
    
    const result = generateUnifiedDiff(oldContent, newContent, "test.txt")
    
    expect(result).toContain("-line 2")
    expect(result).toContain("+line 2 modified")
  })
})

describe("parseDiffHunks edge cases", () => {
  test("handles malformed hunk headers gracefully", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ invalid @@
 line 1`
    
    const result = parseDiffHunks(diff)
    
    // Should return empty or skip malformed hunk
    expect(result).toEqual([])
  })

  test("handles truncated diff without panic", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2`
    // Missing closing lines
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].lines).toHaveLength(2)
  })

  test("handles diff with only headers", () => {
    const diff = `--- a/test.txt
+++ b/test.txt`
    
    const result = parseDiffHunks(diff)
    
    expect(result).toEqual([])
  })

  test("handles mixed line endings in diff", () => {
    const diff = "--- a/test.txt\n+++ b/test.txt\r\n@@ -1,2 +1,2 @@\n line 1\r\n-old\n+new"
    
    const result = parseDiffHunks(diff)
    
    expect(result).toHaveLength(1)
    expect(result[0].lines.length).toBeGreaterThan(0)
  })
})
