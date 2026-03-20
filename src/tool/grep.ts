// Tool: grep — search file contents using ripgrep

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

const MAX_LINE_LENGTH = 2000
const MAX_MATCHES = 100

export const grepTool = defineTool({
  id: "grep",
  description:
    "Fast content search using ripgrep. Searches file contents with regex patterns. " +
    "Returns file paths and line numbers sorted by modification time. " +
    "Use include to filter files (e.g. '*.ts', '*.{js,jsx}').",
  parameters: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (defaults to cwd)"),
    include: z
      .string()
      .optional()
      .describe("File pattern to include (e.g. '*.ts', '*.{js,jsx}')"),
  }),
  async execute(args, ctx) {
    if (!args.pattern) {
      throw new Error("pattern is required")
    }

    // Ask for permission
    await ctx.ask("grep", args.pattern)

    const searchPath = args.path
      ? path.resolve(args.path)
      : process.cwd()

    if (!fs.existsSync(searchPath)) {
      return {
        title: args.pattern,
        output: `Error: Directory not found: ${searchPath}`,
        metadata: { error: "not_found" },
      }
    }

    // Build ripgrep args
    const rgArgs = [
      "-nH", // line numbers, filenames
      "--hidden",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      args.pattern,
    ]

    if (args.include) {
      rgArgs.push("--glob", args.include)
    }

    rgArgs.push(searchPath)

    return new Promise((resolve, reject) => {
      const proc = spawn("rg", rgArgs, {
        signal: ctx.abort,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        // Exit codes: 0 = matches, 1 = no matches, 2 = errors
        if (code === 1 || (code === 2 && !stdout.trim())) {
          resolve({
            title: args.pattern,
            output: "No files found",
            metadata: { matches: 0, truncated: false },
          })
          return
        }

        if (code !== 0 && code !== 2) {
          reject(new Error(`ripgrep failed: ${stderr}`))
          return
        }

        // Parse matches
        const lines = stdout.trim().split(/\r?\n/)
        const matches: Array<{
          path: string
          modTime: number
          lineNum: number
          lineText: string
        }> = []

        for (const line of lines) {
          if (!line) continue

          const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
          if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

          const lineNum = parseInt(lineNumStr, 10)
          const lineText = lineTextParts.join("|")

          try {
            const stats = fs.statSync(filePath)
            matches.push({
              path: filePath,
              modTime: stats.mtime.getTime(),
              lineNum,
              lineText,
            })
          } catch {
            // Skip files we can't stat
          }
        }

        // Sort by modification time (newest first)
        matches.sort((a, b) => b.modTime - a.modTime)

        const truncated = matches.length > MAX_MATCHES
        const finalMatches = truncated ? matches.slice(0, MAX_MATCHES) : matches

        if (finalMatches.length === 0) {
          resolve({
            title: args.pattern,
            output: "No files found",
            metadata: { matches: 0, truncated: false },
          })
          return
        }

        // Format output
        const totalMatches = matches.length
        const outputLines = [
          `Found ${totalMatches} matches${truncated ? ` (showing first ${MAX_MATCHES})` : ""}`,
        ]

        let currentFile = ""
        for (const match of finalMatches) {
          if (currentFile !== match.path) {
            if (currentFile !== "") outputLines.push("")
            currentFile = match.path
            outputLines.push(`${match.path}:`)
          }

          const truncatedText =
            match.lineText.length > MAX_LINE_LENGTH
              ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..."
              : match.lineText
          outputLines.push(`  Line ${match.lineNum}: ${truncatedText}`)
        }

        if (truncated) {
          outputLines.push("")
          outputLines.push(
            `(Results truncated: showing ${MAX_MATCHES} of ${totalMatches} matches)`
          )
        }

        if (code === 2) {
          outputLines.push("")
          outputLines.push("(Some paths were inaccessible and skipped)")
        }

        resolve({
          title: args.pattern,
          output: outputLines.join("\n"),
          metadata: { matches: totalMatches, truncated },
        })
      })

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn ripgrep: ${err.message}`))
      })
    })
  },
})
