// Tool: bash — execute shell commands
//
// Copy to ~/.config/atom/tools/bash.ts

import { spawn } from "child_process"
import { z } from "zod"

const DEFAULT_TIMEOUT = 120_000 // 2 minutes
const MAX_OUTPUT = 50_000 // ~50KB output cap

export default {
  id: "bash",
  description:
    "Execute a shell command and return its output (stdout + stderr combined). " +
    "Commands run in the current working directory. Use timeout to limit long-running commands.",
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    timeout: z
      .number()
      .optional()
      .describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`),
  }),
  async execute(args: { command: string; timeout?: number }, ctx: any) {
    const timeout = args.timeout ?? DEFAULT_TIMEOUT

    return new Promise((resolve) => {
      let output = ""
      let killed = false

      const proc = spawn("sh", ["-c", args.command], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // Ensure child processes can discover their parent session
          ...(ctx.sessionId ? { ATOM_SESSION_ID: ctx.sessionId } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      })

      const appendOutput = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT) {
          output += chunk.toString()
        }
      }

      proc.stdout?.on("data", appendOutput)
      proc.stderr?.on("data", appendOutput)

      // Timeout handling
      const timer = setTimeout(() => {
        killed = true
        proc.kill("SIGTERM")
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL")
        }, 5000)
      }, timeout)

      // Abort signal handling
      const onAbort = () => {
        killed = true
        proc.kill("SIGTERM")
      }
      ctx.abort.addEventListener("abort", onAbort, { once: true })

      proc.on("close", (code) => {
        clearTimeout(timer)
        ctx.abort.removeEventListener("abort", onAbort)

        // Truncate if needed
        let finalOutput = output
        if (output.length >= MAX_OUTPUT) {
          finalOutput =
            output.slice(0, MAX_OUTPUT) +
            `\n\n... (output truncated at ${MAX_OUTPUT} bytes)`
        }

        if (killed) {
          finalOutput += "\n\n(process killed — timeout or abort)"
        }

        resolve({
          title: `bash: ${args.command.slice(0, 80)}`,
          output: finalOutput || "(no output)",
          metadata: {
            command: args.command,
            exitCode: code,
            killed,
            truncated: output.length >= MAX_OUTPUT,
          },
        })
      })

      proc.on("error", (err: Error) => {
        clearTimeout(timer)
        ctx.abort.removeEventListener("abort", onAbort)
        resolve({
          title: `bash error: ${args.command.slice(0, 80)}`,
          output: `Failed to execute command: ${err.message}`,
          metadata: {
            command: args.command,
            error: err.message,
          },
        })
      })
    })
  },
}
