import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

async function renderPrompt(
  thinkingEffort: string,
  options: { width?: number; queuedMessages?: { id: string; text: string }[] } = {},
) {
  const width = options.width ?? 80
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { Prompt } from "./src/tui/components/prompt.tsx";

    const setup = await testRender(() => createComponent(Prompt, {
      onSubmit() {},
      onContentChange() {},
      tokensUsed: 41000,
      tokenLimit: 1000000,
      modelName: "opencode/kimi-k2.6",
      thinkingEffort: ${JSON.stringify(thinkingEffort)},
      width: ${width},
      queuedMessages: ${JSON.stringify(options.queuedMessages ?? [])},
    }), { width: ${width}, height: 14, useConsole: false });

    await setup.renderOnce();
    console.log(JSON.stringify(setup.captureCharFrame().split("\\n")));
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.success) {
    throw new Error(proc.stderr.toString())
  }
  return JSON.parse(proc.stdout.toString()) as string[]
}

describe("Prompt border", () => {
  test("keeps the top border continuous when thinking is off", async () => {
    const lines = await renderPrompt("none")

    expect(lines[0]).toHaveLength(80)
    expect(lines[0]).toMatch(/^╭── 4\.1% of 1M ─+ opencode\/kimi-k2\.6 ──╮$/)
    expect(lines[1]).not.toContain("opencode/kimi-k2.6")
  })

  test("keeps the top border continuous when thinking is on", async () => {
    const lines = await renderPrompt("high")

    expect(lines[0]).toHaveLength(80)
    expect(lines[0]).toMatch(/^╭── 4\.1% of 1M ─+ \[T:high\] opencode\/kimi-k2\.6 ──╮$/)
    expect(lines[1]).not.toContain("[T:high] opencode/kimi-k2.6")
  })

  test("attaches FIFO queue rows without covering the model segment", async () => {
    const lines = await renderPrompt("high", {
      queuedMessages: [
        { id: "old", text: "What improvements would you make here?" },
        { id: "new", text: "Review 你好 👨‍👩‍👧‍👦 next" },
      ],
    })

    expect(lines[1]).toContain("Review 你好 👨‍👩‍👧‍👦 next")
    expect(lines[2]).toContain("What improvements would you make")
    expect(lines[1]).toMatch(/queued │\s+$/)
    expect(lines[3]).toMatch(/╯.*\[T:high\] opencode\/kimi-k2\.6 ──╮$/)
    expect(Bun.stringWidth(lines[3])).toBe(80)
  })

  test("truncates queue text and preserves the right border at narrow widths", async () => {
    const lines = await renderPrompt("high", {
      width: 32,
      queuedMessages: [{ id: "one", text: "A very long queue message with 你好 and emoji 👨‍👩‍👧‍👦" }],
    })

    expect(lines[1]).toContain("…")
    expect(lines[1]).toContain("queued")
    expect(lines[2]).toMatch(/ opencode… ──╮$/)
    expect(Bun.stringWidth(lines[2])).toBe(32)
  })
})
