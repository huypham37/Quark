import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

const commands = [
  { id: "model", title: "Models" },
  { id: "skills", title: "Skills" },
  { id: "sessions", title: "Sessions" },
  { id: "worktree", title: "Worktrees" },
  { id: "connect", title: "Connect a provider" },
] as const

async function navigate(command: typeof commands[number]) {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { App } from "./src/tui/components/App.tsx";

    const command = ${JSON.stringify(command)};
    const entries = [
      {
        key: "command:" + command.id,
        type: "command",
        id: command.id,
        label: "/" + command.id,
        searchText: ["/" + command.id, command.id],
        action: { type: "command", commandId: command.id },
      },
      {
        key: "model:smart",
        type: "model",
        id: "smart",
        label: "Smart",
        searchText: ["Smart", "smart"],
        action: { type: "model", modelId: "smart" },
      },
      {
        key: "skill:review",
        type: "skill",
        id: "review",
        label: "Review",
        searchText: ["Review", "review"],
        action: { type: "skill", skillId: "review" },
      },
    ];
    const setup = await testRender(() => createComponent(App, {
      initialModelName: "smart",
      initialSkillCount: 1,
      onCancel() {},
      onSubmit() {},
      getPaletteEntries: () => entries,
      getSessions: () => [],
      getWorktrees: () => [],
    }), { width: 80, height: 24, useConsole: false });

    await setup.renderOnce();
    await setup.mockInput.pasteBracketedText("saved draft");
    setup.mockInput.pressKey("/", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    await setup.mockInput.typeText("/" + command.id);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    const secondary = setup.captureCharFrame();

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await setup.renderOnce();
    const search = setup.captureCharFrame();

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await setup.renderOnce();
    const composer = setup.captureCharFrame();

    console.log(JSON.stringify({ secondary, search, composer }));
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString()) as { secondary: string; search: string; composer: string }
}

describe("command palette navigation", () => {
  for (const command of commands) {
    test(`Escape returns from ${command.id} to blank search before restoring the composer`, async () => {
      const frames = await navigate(command)
      expect(frames.secondary).toContain(command.title)
      if (command.id === "model" || command.id === "skills") {
        expect(frames.secondary).not.toContain(`> /${command.id}`)
      }
      expect(frames.search).toContain("Search anything in Quark")
      expect(frames.search).not.toContain(`│ > /${command.id}`)
      expect(frames.composer).toContain("saved draft")
      expect(frames.composer).not.toContain("Search anything in Quark")
    })
  }
})
