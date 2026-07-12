// Regression test for issue #170:
// When the prompt textarea is focused, arrow-up/down should move the cursor
// inside the input box, not scroll the conversation pane.
//
// This test runs the TUI in a headless renderer via @opentui/solid's testRender
// because bun:test needs the Solid JSX preload to compile .tsx components.

import { describe, test, expect } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

interface ScenarioResult {
  plainText: string
  scrollBefore: number
  scrollAfter: number
  offsetBefore: number
  offsetAfter: number
}

function runScenario(direction: "up" | "down"): ScenarioResult {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { App } from "./src/tui/components/App.tsx";
    import { bus } from "./src/session/events";
    import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";

    function findScrollBox(r) {
      if (r instanceof ScrollBoxRenderable) return r;
      for (const c of r.getChildren?.() ?? []) {
        const found = findScrollBox(c);
        if (found) return found;
      }
      return null;
    }

    const setup = await testRender(
      () => createComponent(App, {
        onSubmit() {},
        onCancel() {},
        initialSessionId: "arrow-${direction}-session",
        initialModelName: "smart",
        initialSkillCount: 0,
        initialThinkingEffort: "none",
      }),
      { width: 80, height: 12, useConsole: false },
    );

    await setup.renderOnce();

    for (let i = 0; i < 20; i++) {
      bus.emit("user-message", {
        sessionId: "arrow-${direction}-session",
        messageId: \`m\${i}\`,
        text: \`This is message number \${i} with enough text to wrap a bit hopefully.\`,
      });
    }
    await setup.renderOnce();
    await setup.renderOnce();

    const scroll = findScrollBox(setup.renderer.root);
    const scrollBefore = scroll?.scrollTop ?? 0;

    const textarea = setup.renderer.currentFocusedRenderable;
    if (!(textarea instanceof TextareaRenderable)) {
      throw new Error("Expected focused textarea, got " + textarea?.constructor.name);
    }

    await setup.mockInput.pasteBracketedText("line1\\nline2\\nline3");
    if ("${direction}" === "down") {
      textarea.cursorOffset = 0;
    }
    await setup.renderOnce();

    const offsetBefore = textarea.cursorOffset;
    setup.mockInput.pressArrow("${direction}");
    await setup.renderOnce();

    const result = {
      plainText: textarea.plainText,
      scrollBefore,
      scrollAfter: scroll?.scrollTop ?? 0,
      offsetBefore,
      offsetAfter: textarea.cursorOffset,
    };
    console.log(JSON.stringify(result));
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

  const lines = proc.stdout.toString().trim().split("\n")
  const last = lines[lines.length - 1]
  return JSON.parse(last) as ScenarioResult
}

describe("input arrow keys", () => {
  test("arrow-up inside focused prompt moves cursor instead of scrolling conversation", () => {
    const result = runScenario("up")

    expect(result.plainText).toBe("line1\nline2\nline3")
    expect(result.scrollAfter).toBe(result.scrollBefore)
    expect(result.offsetAfter).toBeLessThan(result.offsetBefore)
  })

  test("arrow-down inside focused prompt moves cursor instead of scrolling conversation", () => {
    const result = runScenario("down")

    expect(result.plainText).toBe("line1\nline2\nline3")
    expect(result.scrollAfter).toBe(result.scrollBefore)
    expect(result.offsetAfter).toBeGreaterThan(result.offsetBefore)
  })
})
