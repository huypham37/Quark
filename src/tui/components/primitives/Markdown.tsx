// Markdown — lightweight inline markdown renderer for terminal
//
// Supports: **bold**, *italic*, `code`, [links](url)
// Does NOT handle block elements (headers, lists, code blocks) — those
// are rendered by the message components themselves.

import React, { type ReactNode } from "react"
import { Box, Text } from "ink"
import { colors } from "../../theme"

interface MarkdownProps {
  children: string
}

interface Segment {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

// Parse inline markdown into segments
function parseInline(input: string): Segment[] {
  const segments: Segment[] = []
  // Match: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(input)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index) })
    }

    if (match[2]) {
      // **bold**
      segments.push({ text: match[2], bold: true })
    } else if (match[4]) {
      // *italic*
      segments.push({ text: match[4], italic: true })
    } else if (match[6]) {
      // `code`
      segments.push({ text: match[6], code: true })
    } else if (match[8] && match[9]) {
      // [text](url)
      segments.push({ text: match[8], link: match[9] })
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex) })
  }

  return segments
}

export function Markdown({ children }: MarkdownProps) {
  if (!children) return null
  const segments = parseInline(children)

  return (
    <Text wrap="wrap">
      {segments.map((seg, i) => {
        if (seg.bold) return <Text key={i} bold>{seg.text}</Text>
        if (seg.italic) return <Text key={i} italic>{seg.text}</Text>
        if (seg.code) return <Text key={i} color={colors.warning}>{seg.text}</Text>
        if (seg.link) return <Text key={i} color={colors.toolPath} underline>{seg.text}</Text>
        return <Text key={i}>{seg.text}</Text>
      })}
    </Text>
  )
}

// Render a full block of markdown text (handles line-by-line with bullet points)
interface MarkdownBlockProps {
  text: string
}

export function MarkdownBlock({ text }: MarkdownBlockProps) {
  if (!text) return null

  const lines = text.split("\n")

  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, i) => {
        // Empty lines
        if (!line.trim()) {
          return <Text key={i}> </Text>
        }

        // Bullet points: "- " or "* "
        const bulletMatch = line.match(/^(\s*)[*-]\s(.+)$/)
        if (bulletMatch) {
          const indent = bulletMatch[1] || ""
          const content = bulletMatch[2]!
          return (
            <Text key={i} wrap="wrap">
              {indent}<Text color={colors.muted}>• </Text>
              <Markdown>{content}</Markdown>
            </Text>
          )
        }

        // Headers: "### text" — render bold
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
        if (headerMatch) {
          const content = headerMatch[2]!
          return (
            <Text key={i} bold wrap="wrap">{content}</Text>
          )
        }

        // Horizontal rules: "---" or "***"
        if (/^[-*]{3,}\s*$/.test(line)) {
          return <Text key={i} color={colors.muted}>───</Text>
        }

        // Regular line
        return <Markdown key={i}>{line}</Markdown>
      })}
    </Box>
  )
}
