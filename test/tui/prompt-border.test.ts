import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

async function renderPrompt(thinkingEffort: string) {
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
      width: 80,
    }), { width: 80, height: 8, useConsole: false });

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
})
