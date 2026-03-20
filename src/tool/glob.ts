// Tool: glob — fast file pattern matching using ripgrep

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

const MAX_FILES = 100

export const globTool = defineTool({
  id: "glob",
  description:
    "Fast file pattern matching. Supports glob patterns like '**/*.ts' or 'src/**/*.tsx'. " +
    "Returns matching file paths sorted by modification time.",
  parameters: z.object({
    pattern: z.string().describe("Glob pattern to match (e.g. '**/*.ts')"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (defaults to cwd)"),
  }),
  async execute(args, ctx) {
    if (!args.pattern) {
      throw new Error("pattern is required")
    }

    // Ask for permission
    await ctx.ask("glob", args.pattern)

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

    // Use ripgrep's --files mode with glob
    const rgArgs = [
      "--files",
      "--hidden",
      "--glob",
      args.pattern,
      searchPath,
    ]

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
        // Exit code 1 means no files found
        if (code === 1 || !stdout.trim()) {
          resolve({
            title: args.pattern,
            output: "No files found",
            metadata: { count: 0, truncated: false },
          })
          return
        }

        if (code !== 0) {
          reject(new Error(`ripgrep failed: ${stderr}`))
          return
        }

        // Parse file list and get mod times
        const lines = stdout.trim().split(/\r?\n/)
        const files: Array<{ path: string; mtime: number }> = []

        for (const line of lines) {
          if (!line) continue
          const filePath = line.trim()
          try {
            const stats = fs.statSync(filePath)
            files.push({
              path: filePath,
              mtime: stats.mtime.getTime(),
            })
          } catch {
            // Skip files we can't stat
          }
        }

        // Sort by modification time (newest first)
        files.sort((a, b) => b.mtime - a.mtime)

        const truncated = files.length > MAX_FILES
        const finalFiles = truncated ? files.slice(0, MAX_FILES) : files

        if (finalFiles.length === 0) {
          resolve({
            title: args.pattern,
            output: "No files found",
            metadata: { count: 0, truncated: false },
          })
          return
        }

        // Format output
        const outputLines = finalFiles.map((f) => f.path)

        if (truncated) {
          outputLines.push("")
          outputLines.push(
            `(Results truncated: showing first ${MAX_FILES} of ${files.length} files)`
          )
        }

        resolve({
          title: path.relative(process.cwd(), searchPath) || ".",
          output: outputLines.join("\n"),
          metadata: { count: files.length, truncated },
        })
      })

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn ripgrep: ${err.message}`))
      })
    })
  },
})
