// Component-level test: clicking a ThinkingIndicator expands/collapses it.
//
// This test renders the TSX component, so it runs the renderer in a child
// process with the SolidJS Bun plugin (preload.ts).

import { describe, test, expect } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const THINKING_TEXT = "I need to multiply 17 by 23."

function renderIndicator(props: {
  done?: boolean
  text?: string
  durationMs?: number
  showText?: boolean
}): string[] {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { ThinkingIndicator } from "./src/tui/components/thinking.tsx";

    const setup = await testRender(
      () =>
        createComponent(ThinkingIndicator, {
          done: ${JSON.stringify(props.done ?? false)},
          text: ${JSON.stringify(props.text)},
          durationMs: ${JSON.stringify(props.durationMs)},
          showText: ${JSON.stringify(props.showText ?? false)},
        }),
      { width: 80, height: 10, useConsole: false },
    );
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

async function renderAndClick(props: {
  done?: boolean
  text?: string
  durationMs?: number
  showText?: boolean
  clickY?: number
}): Promise<{ before: string[]; after: string[] }> {
  const clickY = props.clickY ?? 0
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { ThinkingIndicator } from "./src/tui/components/thinking.tsx";

    const setup = await testRender(
      () =>
        createComponent(ThinkingIndicator, {
          done: ${JSON.stringify(props.done ?? false)},
          text: ${JSON.stringify(props.text)},
          durationMs: ${JSON.stringify(props.durationMs)},
          showText: ${JSON.stringify(props.showText ?? false)},
        }),
      { width: 80, height: 10, useConsole: false },
    );
    await setup.renderOnce();
    const before = setup.captureCharFrame().split("\\n");

    await setup.mockMouse.click(20, ${clickY});
    await setup.renderOnce();
    const after = setup.captureCharFrame().split("\\n");

    setup.renderer.destroy();
    console.log(JSON.stringify({ before, after }));
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

  return JSON.parse(proc.stdout.toString()) as { before: string[]; after: string[] }
}

describe("ThinkingIndicator click expansion", () => {
  test("starts collapsed with ▶ and hides text", () => {
    const lines = renderIndicator({
      done: true,
      text: THINKING_TEXT,
      durationMs: 5000,
    })

    const frame = lines.join("\n")
    expect(frame).toContain("▶")
    expect(frame).not.toContain("▼")
    expect(frame).not.toContain(THINKING_TEXT)
  })

  test("clicking the header expands and reveals thinking text", async () => {
    const { before, after } = await renderAndClick({
      done: true,
      text: THINKING_TEXT,
      durationMs: 5000,
    })

    expect(before.join("\n")).toContain("▶")
    expect(before.join("\n")).not.toContain(THINKING_TEXT)

    const afterFrame = after.join("\n")
    expect(afterFrame).toContain("▼")
    expect(afterFrame).not.toContain("▶")
    expect(afterFrame).toContain(THINKING_TEXT)
  })

  test("clicking again collapses and hides thinking text", async () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { ThinkingIndicator } from "./src/tui/components/thinking.tsx";

      const setup = await testRender(
        () =>
          createComponent(ThinkingIndicator, {
            done: true,
            text: ${JSON.stringify(THINKING_TEXT)},
            durationMs: 5000,
            showText: false,
          }),
        { width: 80, height: 10, useConsole: false },
      );
      await setup.renderOnce();

      await setup.mockMouse.click(20, 0);
      await setup.renderOnce();
      const expanded = setup.captureCharFrame().split("\\n");

      await setup.mockMouse.click(20, 0);
      await setup.renderOnce();
      const collapsed = setup.captureCharFrame().split("\\n");

      setup.renderer.destroy();
      console.log(JSON.stringify({ expanded, collapsed }));
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

    const { expanded, collapsed } = JSON.parse(proc.stdout.toString()) as {
      expanded: string[]
      collapsed: string[]
    }

    expect(expanded.join("\n")).toContain("▼")
    expect(expanded.join("\n")).toContain(THINKING_TEXT)

    expect(collapsed.join("\n")).toContain("▶")
    expect(collapsed.join("\n")).not.toContain("▼")
    expect(collapsed.join("\n")).not.toContain(THINKING_TEXT)
  })

  test("shows ▼ and text initially when global showText is true", () => {
    const lines = renderIndicator({
      done: true,
      text: THINKING_TEXT,
      durationMs: 5000,
      showText: true,
    })

    const frame = lines.join("\n")
    expect(frame).toContain("▼")
    expect(frame).not.toContain("▶")
    expect(frame).toContain(THINKING_TEXT)
  })

  test("clicking while globally shown collapses that indicator", async () => {
    const { before, after } = await renderAndClick({
      done: true,
      text: THINKING_TEXT,
      durationMs: 5000,
      showText: true,
    })

    expect(before.join("\n")).toContain("▼")
    expect(before.join("\n")).toContain(THINKING_TEXT)

    const afterFrame = after.join("\n")
    expect(afterFrame).toContain("▶")
    expect(afterFrame).not.toContain("▼")
    expect(afterFrame).not.toContain(THINKING_TEXT)
  })

  test("empty text hides the arrow and ignores clicks", async () => {
    const { before, after } = await renderAndClick({
      done: true,
      text: "",
      durationMs: 5000,
    })

    expect(before.join("\n")).not.toContain("▶")
    expect(before.join("\n")).not.toContain("▼")
    expect(after.join("\n")).not.toContain("▶")
    expect(after.join("\n")).not.toContain("▼")
  })
})
