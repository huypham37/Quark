// Tool: edit — search/replace in existing files
//
// Matching strategy (in order of attempt):
// 1. Exact match
// 2. Line-trimmed match (ignores leading/trailing whitespace per line)
// 3. Block anchor match (first+last line as anchors, fuzzy middle)
//
// Fails if no match found, or if multiple matches found (unless replaceAll).

import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

// ---------------------------------------------------------------------------
// Replacer type — each yields candidate match strings found in content
// ---------------------------------------------------------------------------
type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Strategy 1: exact substring match
const exactReplacer: Replacer = function* (_content, find) {
  yield find
}

// Strategy 2: match lines ignoring leading/trailing whitespace
const lineTrimmedReplacer: Replacer = function* (content, find) {
  const lines = content.split("\n")
  const search = find.split("\n")
  if (search.length > 0 && search[search.length - 1] === "") search.pop()
  if (search.length === 0) return

  for (let i = 0; i <= lines.length - search.length; i++) {
    let match = true
    for (let j = 0; j < search.length; j++) {
      if (lines[i + j]!.trim() !== search[j]!.trim()) {
        match = false
        break
      }
    }
    if (!match) continue

    // Reconstruct the actual text from the original lines
    const block = lines.slice(i, i + search.length).join("\n")
    yield block
  }
}

// Strategy 3: block anchor — first + last line as anchors, accept if middle is similar
const blockAnchorReplacer: Replacer = function* (content, find) {
  const lines = content.split("\n")
  const search = find.split("\n")
  if (search.length < 3) return
  if (search[search.length - 1] === "") search.pop()
  if (search.length < 3) return

  const first = search[0]!.trim()
  const last = search[search.length - 1]!.trim()

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== first) continue
    for (let j = i + 2; j < lines.length; j++) {
      if (lines[j]!.trim() !== last) continue
      const block = lines.slice(i, j + 1).join("\n")
      yield block
      break // only first end-anchor match per start
    }
  }
}

// ---------------------------------------------------------------------------
// Core replace function — tries each strategy in order
// ---------------------------------------------------------------------------
function replace(
  content: string,
  old: string,
  replacement: string,
  all = false,
): string {
  if (old === replacement) {
    throw new Error("oldString and newString are identical — no changes to apply.")
  }

  for (const replacer of [exactReplacer, lineTrimmedReplacer, blockAnchorReplacer]) {
    for (const candidate of replacer(content, old)) {
      const idx = content.indexOf(candidate)
      if (idx === -1) continue

      if (all) {
        return content.replaceAll(candidate, replacement)
      }

      // Check for multiple occurrences
      const last = content.lastIndexOf(candidate)
      if (idx !== last) continue // ambiguous — try next strategy

      return (
        content.substring(0, idx) +
        replacement +
        content.substring(idx + candidate.length)
      )
    }
  }

  // None of the strategies found a match
  const lines = content.split("\n")
  const searchLines = old.split("\n")
  throw new Error(
    `oldString not found in file. ` +
    `File has ${lines.length} lines, search has ${searchLines.length} lines. ` +
    `The oldString must match the file content exactly (including whitespace and indentation).`,
  )
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
export const editTool = defineTool({
  id: "edit",
  description:
    "Search and replace text in an existing file. " +
    "The oldString must match file content (whitespace-flexible). " +
    "Fails if no match is found or if multiple locations match (unless replaceAll is true). " +
    "Use replaceAll to rename variables or change all occurrences.",
  parameters: z.object({
    path: z.string().describe("Absolute path to the file to modify"),
    old: z.string().describe("Exact text to find in the file"),
    new: z.string().describe("Replacement text (must differ from old)"),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace all occurrences (default false)"),
  }),
  async execute(args, _ctx) {
    const filePath = path.resolve(args.path)

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filePath}`)
    }

    const before = fs.readFileSync(filePath, "utf-8")
    const after = replace(before, args.old, args.new, args.replaceAll)

    fs.writeFileSync(filePath, after, "utf-8")

    // Count changes for output
    const addedLines = args.new.split("\n").length
    const removedLines = args.old.split("\n").length

    return {
      title: `Edited ${filePath}`,
      output: `Edit applied successfully. (${removedLines} lines replaced with ${addedLines} lines)`,
      metadata: {
        path: filePath,
        removedLines,
        addedLines,
      },
    }
  },
})

// Export for testing
export { replace }
