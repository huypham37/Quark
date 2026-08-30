import { expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

interface Submission {
  text: string
  sessionId: string | null
  context?: string
}

test("main composer queues and dispatches messages one at a time in FIFO order", () => {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { App } from "./src/tui/components/App.tsx";
    import { bus } from "./src/session/events";
    import { TextareaRenderable } from "@opentui/core";

    const submissions = [];
    const setup = await testRender(() => createComponent(App, {
      initialSessionId: "queue-session",
      initialModelName: "smart",
      initialSkillCount: 0,
      initialThinkingEffort: "none",
      onCancel() {},
      onSubmit(text, sessionId, _images, context) {
        submissions.push({ text, sessionId, context });
        bus.emit("loop-start", { sessionId });
      },
    }), { width: 80, height: 18, useConsole: false });

    await setup.renderOnce();
    bus.emit("loop-start", { sessionId: "queue-session" });

    const textarea = setup.renderer.currentFocusedRenderable;
    if (!(textarea instanceof TextareaRenderable)) throw new Error("main composer is not focused while running");

    await setup.mockInput.pasteBracketedText("first @README.md");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.pasteBracketedText("second message");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    const queuedFrame = setup.captureCharFrame();

    bus.emit("assistant-message-start", { sessionId: "queue-session", messageId: "initial-assistant" });
    bus.emit("assistant-message-end", {
      sessionId: "queue-session",
      messageId: "initial-assistant",
      userMessageId: "initial-user",
      finish: "stop",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterAssistantEnd = submissions.map((item) => item.text);

    bus.emit("loop-end", { sessionId: "queue-session" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    const afterFirst = submissions.map((item) => item.text);

    bus.emit("assistant-message-start", { sessionId: "queue-session", messageId: "first-assistant" });
    bus.emit("assistant-message-end", {
      sessionId: "queue-session",
      messageId: "first-assistant",
      userMessageId: "first-user",
      finish: "stop",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    bus.emit("loop-end", { sessionId: "queue-session" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();

    await setup.mockInput.pasteBracketedText("discard on reset");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    bus.emit("session-reset", { sessionId: "replacement-session" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.log(JSON.stringify({ submissions, afterAssistantEnd, afterFirst, queuedFrame }));
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.success) throw new Error(proc.stderr.toString())
  const result = JSON.parse(proc.stdout.toString()) as {
    submissions: Submission[]
    afterAssistantEnd: string[]
    afterFirst: string[]
    queuedFrame: string
  }

  expect(result.queuedFrame).toContain("second message")
  expect(result.queuedFrame.indexOf("second message")).toBeLessThan(result.queuedFrame.indexOf("first @README.md"))
  expect(result.afterAssistantEnd).toEqual([])
  expect(result.afterFirst).toEqual(["first @README.md"])
  expect(result.submissions.map((item) => item.text)).toEqual(["first @README.md", "second message"])
  expect(result.submissions[0]?.context).toContain('<file path="README.md" />')
})
