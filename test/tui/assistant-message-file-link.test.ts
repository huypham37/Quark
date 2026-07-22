import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

describe("AssistantMessage file links", () => {
  test("shows concise labels and invokes each link's open callback", () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { AssistantMessage } from "./src/tui/components/assistant-message.tsx";
      const opened = [];
      const setup = await testRender(() => createComponent(AssistantMessage, {
        text: "Compare [first.ts](file:///tmp/first.ts#L42C7) and [second.ts](file:///tmp/second.ts#L9).",
        onOpenFile: (target) => opened.push(target),
      }), { width: 80, height: 5, useConsole: false });
      await setup.renderOnce();
      const before = setup.captureCharFrame();
      await setup.mockMouse.click(13, 0);
      await setup.mockMouse.click(31, 0);
      await setup.renderOnce();
      console.log(JSON.stringify({ before, opened }));
      setup.renderer.destroy();
    `
    const proc = Bun.spawnSync({
      cmd: ["bun", "--preload", "./preload.ts", "-e", script],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!proc.success) throw new Error(proc.stderr.toString())

    const result = JSON.parse(proc.stdout.toString()) as { before: string; opened: unknown[] }
    expect(result.before).toContain("Compare ↗ first.ts and ↗ second.ts.")
    expect(result.before).not.toContain("file:///")
    expect(result.opened).toEqual([
      { filePath: "/tmp/first.ts", line: 42, column: 7 },
      { filePath: "/tmp/second.ts", line: 9 },
    ])
  })
})
