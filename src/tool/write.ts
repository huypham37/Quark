// Tool: write — create or overwrite files

import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

export const writeTool = defineTool({
  id: "write",
  description:
    "Create a new file or overwrite an existing file with the given content. " +
    "Creates parent directories if they don't exist. The path should be absolute.",
  parameters: z.object({
    path: z.string().describe("Absolute file path to write"),
    content: z.string().describe("File content to write"),
  }),
  async execute(args, _ctx) {
    const filePath = path.resolve(args.path)
    const existed = fs.existsSync(filePath)

    // Create parent directories if needed
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write the file
    fs.writeFileSync(filePath, args.content, "utf-8")

    const lines = args.content.split("\n").length
    const bytes = Buffer.byteLength(args.content, "utf-8")

    return {
      title: existed ? `Updated ${filePath}` : `Created ${filePath}`,
      output: `${existed ? "Updated" : "Created"} file successfully (${lines} lines, ${bytes} bytes).`,
      metadata: {
        path: filePath,
        existed,
        lines,
        bytes,
      },
    }
  },
})
