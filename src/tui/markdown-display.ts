import type { OnChunksCallback, OnHighlightCallback } from "@opentui/core"

const WEB_URL_RE = /^https?:\/\//i

export const concealMarkdownInlineDelimiters: OnHighlightCallback = (highlights, context) => {
  const out = highlights.filter(([start, end, group, meta]) => {
    if (group === "conceal" && meta?.conceal === " " && context.content.slice(start, end) === "]") return false
    if (group !== "conceal" || meta?.conceal !== "" || meta.isInjection) return true
    return true
  })

  addInlineConceals(out, context.content)
  return out
}

export const stripMarkdownLinkUrls: OnChunksCallback = (chunks) => {
  const out: typeof chunks = []

  for (let i = 0; i < chunks.length; i++) {
    const url = chunks[i + 2]?.text ?? ""
    const isRenderedLinkUrl =
      chunks[i]?.text === " " && chunks[i + 1]?.text === "(" && WEB_URL_RE.test(url) && chunks[i + 3]?.text === ")"

    if (isRenderedLinkUrl) {
      i += 3
      continue
    }

    out.push(chunks[i]!)
  }

  return out
}

function addInlineConceals(highlights: Parameters<OnHighlightCallback>[0], content: string): void {
  let offset = 0
  let inFence = false

  for (const line of content.split(/(\n)/)) {
    if (line === "\n") {
      offset += line.length
      continue
    }

    const fence = line.match(/^(\s*)(```|~~~)/)
    if (fence) {
      inFence = !inFence
      offset += line.length
      continue
    }

    if (!inFence) {
      addInlineCodeConceals(highlights, line, offset)
      addDelimitedConceals(highlights, line, offset, "***")
      addDelimitedConceals(highlights, line, offset, "**")
      addDelimitedConceals(highlights, line, offset, "*")
      addDelimitedConceals(highlights, line, offset, "~~")
      addLinkConceals(highlights, line, offset)
    }

    offset += line.length
  }
}

function addInlineCodeConceals(highlights: Parameters<OnHighlightCallback>[0], line: string, offset: number): void {
  for (const match of line.matchAll(/`[^`\n]+`/g)) {
    const start = offset + match.index
    addConceal(highlights, start, start + 1)
    addConceal(highlights, start + match[0].length - 1, start + match[0].length)
  }
}

function addDelimitedConceals(
  highlights: Parameters<OnHighlightCallback>[0],
  line: string,
  offset: number,
  delimiter: string,
): void {
  let start = 0

  while (start < line.length) {
    const open = line.indexOf(delimiter, start)
    if (open < 0) return

    const contentStart = open + delimiter.length
    const close = line.indexOf(delimiter, contentStart)
    if (close < 0) return

    if (hasDelimitedContent(line, contentStart, close, delimiter)) {
      addConceal(highlights, offset + open, offset + contentStart)
      addConceal(highlights, offset + close, offset + close + delimiter.length)
      start = close + delimiter.length
    } else {
      start = contentStart
    }
  }
}

function hasDelimitedContent(line: string, start: number, end: number, delimiter: string): boolean {
  if (start >= end) return false
  if (delimiter === "*" && (line[start] === "*" || line[end - 1] === "*")) return false
  return true
}

function addLinkConceals(highlights: Parameters<OnHighlightCallback>[0], line: string, offset: number): void {
  for (const match of line.matchAll(/\[[^\]\n]+\]\([^)]+\)/g)) {
    const start = offset + match.index
    const text = match[0]
    const closeBracket = text.indexOf("]")

    addConceal(highlights, start, start + 1)
    addConceal(highlights, start + closeBracket, start + text.length)
  }
}

function addConceal(highlights: Parameters<OnHighlightCallback>[0], start: number, end: number): void {
  highlights.push([start, end, "conceal", { conceal: "", isInjection: true }])
}
