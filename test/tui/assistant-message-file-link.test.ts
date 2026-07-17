import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

describe("AssistantMessage file links", () => {
  test("shows a concise label and invokes its open callback on click", () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { AssistantMessage } from "./src/tui/components/assistant-message.tsx";
      const opened = [];
      const setup = await testRender(() => createComponent(AssistantMessage, {
        text: "This is a link: [src/index.ts](file:///tmp/a%20file.ts#L42C7).",
        onOpenFile: (target) => opened.push(target),
      }), { width: 80, height: 5, useConsole: false });
      await setup.renderOnce();
      const before = setup.captureCharFrame();
      await setup.mockMouse.click(22, 0);
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
    expect(result.before).toContain("This is a link: ↗ src/index.ts.")
    expect(result.before).not.toContain("file:///")
    expect(result.opened).toEqual([{ filePath: "/tmp/a file.ts", line: 42, column: 7 }])
  })
})
