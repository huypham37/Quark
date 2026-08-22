import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

function renderPreview(): string {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { Autocomplete } from "./src/tui/components/autocomplete.tsx";

    const setup = await testRender(
      () => createComponent(Autocomplete, {
        mode: {
          type: "sessions",
          rows: [
            { type: "orphan", id: "one", label: "Session one", current: true },
            { type: "orphan", id: "two", label: "Session two", current: false },
          ],
          selectedIndex: 0,
          query: "",
          action: "browse",
          scope: "worktree",
          preview: { user: "Fix the auth flow", assistant: "Auth flow inspected." },
        },
      }),
      { width: 140, height: 20, useConsole: false },
    );

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

describe("session picker preview layout", () => {
  test("shows both transcript roles with only two session rows", () => {
    const frame = renderPreview()
    expect(frame).toContain("You: Fix the auth flow")
    expect(frame).toContain("Quark: Auth flow inspected.")
  })
})
