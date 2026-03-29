# Code Diff Feature - TDD Test Suite

## Overview
This test suite follows TDD (Test-Driven Development) principles for a code diff display feature in the Quark TUI. These tests are written **before** implementation (red phase).

## Test File
- **Location**: `test/tui/diff-view.test.ts`
- **Framework**: Bun test
- **Focus**: Pure utility functions (not UI components)

## Functions Under Test

### 1. `generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string`
Generates a unified diff format string from two content versions.

**Test Coverage** (19 tests):
- Identical content returns empty string
- File headers with correct paths
- Added lines marked with `+`
- Removed lines marked with `-`
- Context lines marked with space
- Hunk headers with line numbers
- New file handling (empty oldContent → `/dev/null`)
- Deleted file handling (empty newContent → `/dev/null`)
- Multiple separate hunks
- No trailing newline handling
- Empty lines preserved
- Very long lines
- Special characters (tabs, quotes)
- Unicode characters (世界, 🚀)
- Windows line endings (CRLF)

### 2. `parseDiffHunks(diff: string): DiffHunk[]`
Parses a unified diff string into structured hunk objects.

**Types**:
```typescript
type DiffLine = {
  type: "context" | "added" | "removed"
  content: string
  oldLineNo?: number
  newLineNo?: number
}

type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}
```

**Test Coverage** (16 tests):
- Empty string returns empty array
- Non-diff content returns empty array
- Single hunk parsing
- Line type identification (context, added, removed)
- Multiple hunks in same diff
- Only additions (new file)
- Only deletions (deleted file)
- Correct line number tracking
- Empty lines in hunks
- Metadata lines ignored
- Function context in hunk headers
- Single-line count format (`@@ -1 +1,2 @@`)
- Malformed headers handled gracefully
- Truncated diffs don't panic
- Diff with only headers
- Mixed line endings

### 3. Type Integration Tests (2 tests)
Verify that `TuiPart` type in `state.ts` can accommodate an optional `diff` field in tool parts.

## Running the Tests

```bash
# Run all TUI tests
bun test test/tui/

# Run only diff tests
bun test test/tui/diff-view.test.ts

# Run with verbose output
bun test test/tui/diff-view.test.ts --verbose
```

## Expected Behavior (All Tests Should Fail Initially)

Since this is TDD red phase:
1. ✗ All tests will fail because functions don't exist yet
2. ✗ Import errors for `generateUnifiedDiff` and `parseDiffHunks`
3. ✗ Type errors for `diff` field on `TuiPart`

## Next Steps (Implementation - Green Phase)

1. Create `src/tui/diff-utils.ts` with:
   - `generateUnifiedDiff()` implementation
   - `parseDiffHunks()` implementation
   - Export types: `DiffLine`, `DiffHunk`

2. Update `src/tui/state.ts`:
   - Add optional `diff?: string` field to tool part in `TuiPart` type

3. Run tests iteratively:
   ```bash
   bun test test/tui/diff-view.test.ts --watch
   ```

4. Implement minimal code to make each test pass

5. Refactor once all tests are green

## Implementation Hints

### generateUnifiedDiff
Consider using:
- String splitting and line-by-line comparison
- Myers diff algorithm or simpler LCS (Longest Common Subsequence)
- NPM package like `diff` (e.g., `diff.createPatch()`)

### parseDiffHunks
- RegEx for hunk header: `/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/`
- State machine for line-by-line parsing
- Track line numbers as you parse through hunks

## Test Patterns Used

Following existing Quark TUI test conventions:
- Import from `bun:test` (not Jest)
- Descriptive test names with clear expectations
- Grouped by function in `describe` blocks
- Edge cases in separate describe blocks
- Type-level tests where appropriate
- No mocking of external dependencies for pure functions

## References

- Existing test patterns: `test/tui/notifications.test.ts`, `test/tui/spinner.test.ts`
- State types: `src/tui/state.ts`
- Unified diff format: https://en.wikipedia.org/wiki/Diff#Unified_format
