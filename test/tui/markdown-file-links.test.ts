import { describe, expect, test } from "bun:test"
import { splitMarkdownFileLinks } from "../../src/tui/markdown-file-links"

describe("inline markdown file links", () => {
  test("preserves surrounding paragraph text around a local file link", () => {
    expect(splitMarkdownFileLinks("This is a link: [src/index.ts](file:///tmp/a.ts#L42C7)."))
      .toEqual([{ type: "file-line", parts: [
        { text: "This is a link: " },
        { target: { filePath: "/tmp/a.ts", line: 42, column: 7 }, label: "src/index.ts" },
        { text: "." },
      ] }])
  })

  test("preserves surrounding list-item text around a local file link", () => {
    expect(splitMarkdownFileLinks("- Random tool: [question.ts](file:///tmp/question.ts)"))
      .toEqual([{ type: "file-line", marker: "- ", parts: [
        { text: "Random tool: " },
        { target: { filePath: "/tmp/question.ts" }, label: "question.ts" },
      ] }])
  })

  test("renders multiple local file links in a paragraph", () => {
    expect(splitMarkdownFileLinks("Read [this](file:///tmp/a.ts) and [that](file:///tmp/b.ts)."))
      .toEqual([{ type: "file-line", parts: [
        { text: "Read " },
        { target: { filePath: "/tmp/a.ts" }, label: "this" },
        { text: " and " },
        { target: { filePath: "/tmp/b.ts" }, label: "that" },
        { text: "." },
      ] }])
  })

  test("renders multiple local file links in a list item", () => {
    expect(splitMarkdownFileLinks("- Compare [before](file:///tmp/a.ts) with [after](file:///tmp/b.ts)."))
      .toEqual([{ type: "file-line", marker: "- ", parts: [
        { text: "Compare " },
        { target: { filePath: "/tmp/a.ts" }, label: "before" },
        { text: " with " },
        { target: { filePath: "/tmp/b.ts" }, label: "after" },
        { text: "." },
      ] }])
  })

  test("leaves complex, web, and remote file links to MarkdownRenderable", () => {
    for (const content of [
      "[web](https://example.com)",
      "[remote](file://server/tmp/a.ts)",
      "Read [local](file:///tmp/a.ts) and [web](https://example.com).",
      "- [this](file:///tmp/a.ts)\n  - nested",
    ]) expect(splitMarkdownFileLinks(content)).toEqual([{ type: "markdown", content }])
  })
})
