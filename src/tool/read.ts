// Tool: read — read files and directories with line ranges

import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

const DEFAULT_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export const readTool = defineTool({
  id: "read",
  description:
    "Read a file or directory. Returns line-numbered content for files, entry listing for directories. " +
    "Use offset/limit to read specific sections of large files.",
  parameters: z.object({
    path: z.string().describe("Absolute or relative file/directory path"),
    offset: z
      .number()
      .optional()
      .describe("Starting line number (1-indexed, default 1)"),
    limit: z
      .number()
      .optional()
      .describe(`Maximum number of lines to read (default ${DEFAULT_LIMIT})`),
  }),
  async execute(args, _ctx) {
    const filePath = path.resolve(args.path)

    if (!fs.existsSync(filePath)) {
      return {
        title: `File not found: ${filePath}`,
        output: `Error: ${filePath} does not exist`,
        metadata: { path: filePath, error: "not_found" },
      }
    }

    const stat = fs.statSync(filePath)

    // Directory listing
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath)
      const listing = entries
        .map((entry) => {
          const entryPath = path.join(filePath, entry)
          try {
            const entryStat = fs.statSync(entryPath)
            return entryStat.isDirectory() ? `${entry}/` : entry
          } catch {
            return entry
          }
        })
        .join("\n")

      return {
        title: `Directory: ${filePath}`,
        output: listing || "(empty directory)",
        metadata: { path: filePath, type: "directory", entries: entries.length },
      }
    }

    // Binary detection (check first 8KB for null bytes)
    const fd = fs.openSync(filePath, "r")
    const probe = Buffer.alloc(8192)
    const bytesRead = fs.readSync(fd, probe, 0, 8192, 0)
    fs.closeSync(fd)

    for (let i = 0; i < bytesRead; i++) {
      if (probe[i] === 0) {
        return {
          title: `Binary file: ${filePath}`,
          output: `Binary file detected (${stat.size} bytes). Cannot display contents.`,
          metadata: { path: filePath, type: "binary", size: stat.size },
        }
      }
    }

    // Read text file
    const content = fs.readFileSync(filePath, "utf-8")
    const allLines = content.split("\n")
    const totalLines = allLines.length

    const offset = Math.max(1, args.offset ?? 1)
    const limit = args.limit ?? DEFAULT_LIMIT
    const startIdx = offset - 1
    const endIdx = Math.min(startIdx + limit, totalLines)
    const lines = allLines.slice(startIdx, endIdx)

    // Format with line numbers, truncate long lines
    const numbered = lines
      .map((line, i) => {
        const lineNum = startIdx + i + 1
        const truncated =
          line.length > MAX_LINE_LENGTH
            ? line.slice(0, MAX_LINE_LENGTH) + "..."
            : line
        return `${lineNum}: ${truncated}`
      })
      .join("\n")

    const footer =
      endIdx < totalLines
        ? `\n\n(Showing lines ${offset}-${endIdx} of ${totalLines} total)`
        : `\n\n(End of file - total ${totalLines} lines)`

    return {
      title: `Read ${filePath}`,
      output: numbered + footer,
      metadata: {
        path: filePath,
        type: "file",
        totalLines,
        offset,
        linesReturned: lines.length,
      },
    }
  },
})
