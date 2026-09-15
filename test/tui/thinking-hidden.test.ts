import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

function renderMessage(done: boolean): string {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { App } from "./src/tui/components/App.tsx";

    const setup = await testRender(
      () => createComponent(App, {
        initialSessionId: "thinking-hidden-session",
        initialModelName: "smart",
        initialSkillCount: 0,
        onSubmit() {},
        onCancel() {},
        initialMessages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "thinking", done: ${done}, text: "SECRET_REASONING", durationMs: 5000 },
          ],
        }],
      }),
      { width: 80, height: 10, useConsole: false },
    );
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    setup.renderer.destroy();
    console.log(JSON.stringify(frame));
  `

  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString()) as string
}

describe("TUI thinking parts", () => {
  test.each([false, true])("does not render thinking content when done=%s", (done) => {
    const frame = renderMessage(done)

    expect(frame).not.toContain("SECRET_REASONING")
    expect(frame).not.toContain("Thinking")
    expect(frame).not.toContain("Thought")
  })
})
