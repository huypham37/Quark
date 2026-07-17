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

  test("leaves complex, web, and remote file links to MarkdownRenderable", () => {
    for (const content of [
      "Read [this](file:///tmp/a.ts) and [that](file:///tmp/b.ts).",
      "[web](https://example.com)",
      "[remote](file://server/tmp/a.ts)",
      "- [this](file:///tmp/a.ts)\n  - nested",
    ]) expect(splitMarkdownFileLinks(content)).toEqual([{ type: "markdown", content }])
  })
})
