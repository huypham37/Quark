import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CodeRenderable, SyntaxStyle } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { concealMarkdownInlineDelimiters, stripMarkdownLinkUrls } from "../../src/tui/markdown-display"
import { darkTheme } from "../../src/tui/themes/dark"
import { lightTheme } from "../../src/tui/themes/light"

describe("markdown theme scopes", () => {
  test("registers OpenTUI block heading scopes", () => {
    for (const theme of [darkTheme, lightTheme]) {
      const style = SyntaxStyle.fromTheme(theme.syntax)

      expect(style.getStyle("markup.heading")).toBeDefined()
      expect(style.getStyle("markup.heading.1")).toBeDefined()
      expect(style.getStyle("markup.heading.6")).toBeDefined()
      if (theme === darkTheme) {
        expect(style.getStyle("markup.strong")?.fg?.toInts()).toEqual([229, 192, 123, 255])
      }

      style.destroy()
    }
  })

  test("assistant messages use source-like markdown conceal rendering", () => {
    const source = readFileSync("src/tui/components/assistant-message.tsx", "utf8")

    expect(source).toContain("<code")
    expect(source).toContain('filetype="markdown"')
    expect(source).toContain("conceal={true}")
    expect(source).toContain("onHighlight={concealMarkdownInlineDelimiters}")
    expect(source).toContain("onChunks={stripMarkdownLinkUrls}")
  })

  test("renders markdown like a concealed source buffer", async () => {
    const style = SyntaxStyle.fromTheme(darkTheme.syntax)
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 24 })
    const markdown = new CodeRenderable(renderer, {
      id: "markdown-source",
      content: readFileSync("test.md", "utf8"),
      filetype: "markdown",
      syntaxStyle: style,
      conceal: true,
      drawUnstyledText: false,
      streaming: false,
      onHighlight: concealMarkdownInlineDelimiters,
      onChunks: stripMarkdownLinkUrls,
      width: "100%",
    })

    renderer.root.add(markdown)
    for (let i = 0; i < 8; i++) {
      await renderOnce()
      await new Promise((resolve) => setTimeout(resolve, 80))
    }

    const frame = captureCharFrame()
    expect(frame).toContain("Heading 1")
    expect(frame).toContain("Heading 2")
    expect(frame).not.toContain("# Heading 1")
    expect(frame).not.toContain("## Heading 2")
    expect(frame).toContain("Plain paragraph with bold, italic, bold italic, strike, and inline code.")
    expect(frame).toContain("A link to example.")
    expect(frame).toContain("- Unordered item one")
    expect(frame).toContain("const x: number = 42")
    expect(frame).not.toContain("**bold**")
    expect(frame).not.toContain("`code`")
    expect(frame).not.toContain("https://example.com")
    expect(frame).not.toContain("```ts")

    renderer.destroy()
    style.destroy()
  })

})
