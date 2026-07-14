import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

type Status = "sent" | "replied" | "aborted" | "failed"

function renderUserMessage(status: Status): string {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { UserMessage } from "./src/tui/components/user-message.tsx";

    const setup = await testRender(
      () => createComponent(UserMessage, {
        text: "lifecycle fixture",
        images: [{ label: "Image 1" }],
        status: ${JSON.stringify(status)},
      }),
      { width: 60, height: 6, useConsole: false },
    );
    await setup.renderOnce();
    console.log(setup.captureCharFrame());
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  return proc.stdout.toString()
}

describe("UserMessage lifecycle presentation", () => {
  test("renders a sent message and its image chip", () => {
    const frame = renderUserMessage("sent")
    expect(frame).toContain("| lifecycle fixture")
    expect(frame).toContain("| [Image 1]")
  })

  test.each(["replied", "aborted", "failed"] as const)("keeps a %s message and its image chip visible", (status) => {
    const frame = renderUserMessage(status)
    expect(frame).toContain("| lifecycle fixture")
    expect(frame).toContain("| [Image 1]")
  })
})
