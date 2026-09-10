import { expect, test } from "bun:test"
import { BoxRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { lightTheme } from "../../src/tui/themes/light"

test("light surface fades background content while the palette stays opaque", async () => {
  const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: 20, height: 2 })
  try {
    const root = new BoxRenderable(renderer, {
      width: 20, height: 2, flexDirection: "column",
      backgroundColor: lightTheme.colors.dropdownBg,
    })
    const conversation = new BoxRenderable(renderer, { width: 20, height: 1, opacity: 0.35 })
    conversation.add(new TextRenderable(renderer, { content: "Background", fg: lightTheme.colors.text }))
    root.add(conversation)
    root.add(new TextRenderable(renderer, { content: "Palette", fg: lightTheme.colors.text, height: 1 }))
    renderer.root.add(root)
    await renderOnce()

    const lines = captureSpans().lines
    const faded = lines[0]!.spans[0]!.fg
    const palette = lines[1]!.spans[0]!.fg
    expect(faded.r).toBeGreaterThan(0.55)
    expect(faded.r).toBeLessThan(0.8)
    expect(faded.a).toBe(1)
    expect(palette.r).toBeCloseTo(lightTheme.colors.text.r, 2)
  } finally {
    renderer.destroy()
  }
})
