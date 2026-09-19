import { marked } from "marked"
import { displayFileTarget, parseFileUri, type FileTarget } from "./editor"

export type InlineFileLink = { text: string } | { target: FileTarget; label: string }
export type MarkdownSegment =
  | { type: "markdown"; content: string }
  | { type: "file-line"; marker?: string; parts: InlineFileLink[] }

/**
 * Replace only simple final paragraphs/list items containing local file links.
 * Their visible text remains inline; complex Markdown stays with OpenTUI.
 */
export function splitMarkdownFileLinks(content: string): MarkdownSegment[] {
  const tokens = marked.lexer(content)
  const segments: MarkdownSegment[] = []
  let markdown = ""
  const flushMarkdown = () => {
    if (markdown) segments.push({ type: "markdown", content: markdown })
    markdown = ""
  }
  const plainFileLinks = (text: string): { parts: InlineFileLink[]; count: number } => {
    const parts: InlineFileLink[] = []
    const pattern = /([^()\s]+)\s+\((file:\/\/[^)\s]+)\)/g
    let cursor = 0
    let count = 0
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      const target = parseFileUri(match[2])
      if (!target) continue
      if (start > cursor) parts.push({ text: text.slice(cursor, start) })
      parts.push({ target, label: match[1] })
      cursor = start + match[0].length
      count++
    }
    if (count === 0) return { parts: [{ text }], count: 0 }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) })
    return { parts, count }
  }

  const lineParts = (token: any): InlineFileLink[] | null => {
    const inline = token?.tokens?.filter((child: any) => child.type !== "space")
    if (!inline?.length) return null
    const parts: InlineFileLink[] = []
    let fileLinks = 0
    for (const child of inline) {
      if (child.type === "text") {
        const plain = plainFileLinks(child.text)
        parts.push(...plain.parts)
        fileLinks += plain.count
      } else if (child.type === "link") {
        const target = parseFileUri(child.href)
        const simpleLabel = child.tokens?.length === 1 && child.tokens[0]?.type === "text"
        if (!target || !simpleLabel) return null
        fileLinks++
        parts.push({ target, label: child.text || displayFileTarget(target) })
      } else return null
    }
    return fileLinks > 0 ? parts : null
  }

  for (const token of tokens) {
    if (token.type === "paragraph") {
      const parts = lineParts(token)
      if (parts) {
        flushMarkdown()
        segments.push({ type: "file-line", parts })
      } else markdown += token.raw
      continue
    }
    if (token.type === "list" && !token.ordered && !token.loose && token.items.every((item: any) => !item.task && item.tokens?.length === 1)) {
      const items = token.items.map((item: any) => lineParts(item.tokens[0]))
      if (items.every(Boolean)) {
        flushMarkdown()
        for (const parts of items) segments.push({ type: "file-line", marker: "- ", parts: parts! })
        continue
      }
    }
    markdown += token.raw
  }
  flushMarkdown()
  return segments
}
