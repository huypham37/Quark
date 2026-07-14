import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

type Status = "sent" | "replied" | "aborted" | "failed"

interface SpanInfo {
  text: string
  attributes: number
  fg?: { buffer: number[] }
}

interface CaptureResult {
  lines: { spans: SpanInfo[] }[]
}

function renderUserMessage(status: Status): { frame: string; spans: SpanInfo[] } {
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
    const capture = setup.captureSpans();
    console.log(JSON.stringify({ frame: setup.captureCharFrame(), spans: capture.lines[0].spans }));
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./preload.ts", "-e", script],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  const parsed = JSON.parse(proc.stdout.toString()) as { frame: string; spans: SpanInfo[] }
  return parsed
}

const ITALIC_ATTR = 1 << 2

describe("UserMessage lifecycle presentation", () => {
  test("renders a sent message without italic", () => {
    const { frame, spans } = renderUserMessage("sent")
    expect(frame).toContain("| lifecycle fixture")
    expect(frame).toContain("| [Image 1]")
    expect(spans.some((s) => (s.attributes & ITALIC_ATTR) !== 0)).toBe(false)
  })

  test.each(["replied", "aborted", "failed"] as const)("renders a %s message italic and keeps content visible", (status) => {
    const { frame, spans } = renderUserMessage(status)
    expect(frame).toContain("| lifecycle fixture")
    expect(frame).toContain("| [Image 1]")
    expect(spans.some((s) => (s.attributes & ITALIC_ATTR) !== 0)).toBe(true)
  })
})
