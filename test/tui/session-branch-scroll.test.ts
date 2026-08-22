import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

function renderBranchSwitch(): string {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { App } from "./src/tui/components/App.tsx";
    import { bus } from "./src/session/events";

    const setup = await testRender(
      () => createComponent(App, {
        onSubmit() {},
        onCancel() {},
        initialSessionId: "parent",
        initialModelName: "smart",
        initialSkillCount: 0,
      }),
      { width: 100, height: 18, useConsole: false },
    );

    await setup.renderOnce();
    for (let index = 0; index < 16; index++) {
      bus.emit("user-message", {
        sessionId: "parent",
        messageId: "parent-" + index,
        text: "Parent history " + index,
      });
    }
    await setup.renderOnce();

    bus.emit("session-switch", {
      kind: "branch",
      sessionId: "child",
      messages: [],
      estimatedTokens: 0,
      divider: { id: "branch:child", goal: "Compacted history", label: "Compacted" },
    });

    await setup.renderOnce();
    await setup.renderOnce();
    console.log(JSON.stringify(setup.captureCharFrame()));
    setup.renderer.destroy();
  `

  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString().trim()) as string
}

describe("session branch scrolling", () => {
  test("renders a trailing divider when the child has no visible messages", () => {
    const frame = renderBranchSwitch()
    expect(frame).toContain("Compacted")
  })
})
