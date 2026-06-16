// mention-context.ts — pure parser for @file / @directory context blocks.
//
// Extracted from mention-chips.tsx so the parsing logic can be unit-tested
// without pulling in the @opentui/solid JSX runtime.

// Parsed context item extracted from XML-style blocks
export interface ContextItem {
  type: "file" | "directory"
  path: string
  content?: string
  files?: { name: string; content?: string; isDir: boolean }[]
}

/**
 * Parse <directory> and <file> XML blocks from text and extract them.
 * Returns the cleaned text (without the XML blocks) and the list of items.
 */
export function parseContextBlocks(text: string): { cleaned: string; items: ContextItem[] } {
  const items: ContextItem[] = []

  // Extract self-closing <directory path="..." /> blocks
  const dirSelfCloseRegex = /<directory path="([^"]+)"\s*\/>/g
  let match: RegExpExecArray | null
  while ((match = dirSelfCloseRegex.exec(text)) !== null) {
    items.push({ type: "directory", path: match[1]!, files: [] })
  }

  // Extract <directory> blocks with inner content (legacy: file listing)
  const dirRegex = /<directory path="([^"]+)">([\s\S]*?)<\/directory>/g
  while ((match = dirRegex.exec(text)) !== null) {
    const path = match[1]!
    const body = match[2] ?? ""
    const files: { name: string; content?: string; isDir: boolean }[] = []

    // Parse <file> tags inside directory
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = fileRegex.exec(body)) !== null) {
      const fname = fileMatch[1]!
      const fcontent = fileMatch[2]
      files.push({ name: fname, content: fcontent, isDir: false })
    }

    // Parse <subdirectory> tags
    const subdirRegex = /<subdirectory name="([^"]+)"\s*\/>/g
    let subdirMatch: RegExpExecArray | null
    while ((subdirMatch = subdirRegex.exec(body)) !== null) {
      files.push({ name: subdirMatch[1] ?? "", isDir: true })
    }

    items.push({ type: "directory", path, files })
  }

  // Extract self-closing <file path="..." /> blocks (path-only mentions)
  const fileSelfCloseRegex = /<file path="([^"]+)"\s*\/>/g
  while ((match = fileSelfCloseRegex.exec(text)) !== null) {
    const path = match[1]!
    if (!items.some((i) => i.type === "file" && i.path === path)) {
      items.push({ type: "file", path })
    }
  }

  // Extract standalone <file> blocks with content (legacy / inside directories)
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  while ((match = fileRegex.exec(text)) !== null) {
    // Skip if this was already captured inside a <directory> block
    const path = match[1]!
    const content = match[2]
    if (!items.some((i) => i.type === "file" && i.path === path)) {
      items.push({ type: "file", path, content })
    }
  }

  // Clean up the text by removing all XML blocks
  const cleaned = text
    .replace(/<directory[^>]*\/>/g, "")
    .replace(/<directory[^>]*>[\s\S]*?<\/directory>/g, "")
    .replace(/<file[^>]*\/>/g, "")
    .replace(/<file[^>]*>[\s\S]*?<\/file>/g, "")
    .replace(/<subdirectory[^>]*\/>/g, "")
    .trim()

  return { cleaned, items }
}
