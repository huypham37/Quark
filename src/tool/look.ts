// Tool: look — read an image file and pass it to the model as visual content
//
// Unlike `read` (which returns raw bytes as text garbage), `look` converts
// image files to base64 and injects them into the conversation via a synthetic
// user message, so the model can actually *see* the pixels.

import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"
import { saveUserMessage } from "../session/message"

// MIME type lookup by file extension
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".avif": "image/avif",
}

const SUPPORTED_EXTS = Object.keys(MIME_BY_EXT).join(", ")

export const lookTool = defineTool({
  id: "look",
  description:
    "Look at an image file so the model can see its visual content. " +
    "Use this instead of 'read' for image files (PNG, JPEG, GIF, WebP, etc.). " +
    `Supported extensions: ${SUPPORTED_EXTS}.`,
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to an image file"),
  }),
  async execute(args, ctx) {
    const filePath = path.resolve(args.path)

    if (!fs.existsSync(filePath)) {
      return {
        title: `Not found: ${filePath}`,
        output: `Error: ${filePath} does not exist`,
        metadata: { path: filePath, error: "not_found" },
      }
    }

    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      return {
        title: `Is a directory: ${filePath}`,
        output: `Error: ${filePath} is a directory, not an image file`,
        metadata: { path: filePath, error: "is_directory" },
      }
    }

    const ext = path.extname(filePath).toLowerCase()
    const mimeType = MIME_BY_EXT[ext]
    if (!mimeType) {
      return {
        title: `Not an image: ${filePath}`,
        output: `Error: ${filePath} doesn't appear to be a supported image (extension: ${ext || "none"}). Supported: ${SUPPORTED_EXTS}`,
        metadata: { path: filePath, error: "unsupported_type", ext },
      }
    }

    // Read the binary image and convert to base64
    const buffer = fs.readFileSync(filePath)
    const base64 = buffer.toString("base64")

    // Inject the image as a synthetic user message so the model can see it.
    // This bypasses the tool-result channel (which OpenAI/Copilot stringifies
    // to JSON) and reuses the well-tested user-message image pipeline.
    saveUserMessage({
      sessionId: ctx.sessionId,
      text: `[Image: ${path.basename(filePath)}]`,
      images: [{ mime: mimeType, data: base64 }],
    })

    return {
      title: `Look ${filePath}`,
      output: `✓ Looked at ${path.basename(filePath)} (${mimeType}, ${formatSize(stat.size)}). Image passed to model.`,
      metadata: {
        path: filePath,
        type: "image",
        size: stat.size,
        mediaType: mimeType,
      },
    }
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
