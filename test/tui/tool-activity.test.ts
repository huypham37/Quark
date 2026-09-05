import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { getToolActivityKind, groupMessageParts } from "../../src/tui/components/tool-activity"
import type { TuiPart } from "../../src/tui/state"

const ROOT = resolve(import.meta.dir, "../..")

function tool(tool: string, status: "pending" | "running" | "completed" | "error" = "completed"): TuiPart {
  return { type: "tool", tool, callId: tool, status, input: { path: `/${tool}.ts` } }
}

describe("tool activity grouping", () => {
  test("maps tools to user-facing activities", () => {
    expect(getToolActivityKind("Read")).toBe("explore")
    expect(getToolActivityKind("grep")).toBe("explore")
    expect(getToolActivityKind("glob")).toBe("explore")
    expect(getToolActivityKind("write")).toBe("modify")
    expect(getToolActivityKind("edit")).toBe("modify")
    expect(getToolActivityKind("websearch")).toBe("internet")
    expect(getToolActivityKind("webfetch")).toBe("internet")
    expect(getToolActivityKind("bash")).toBe("command")
  })

  test("combines adjacent tools with the same purpose", () => {
    const items = groupMessageParts([
      tool("read"),
      tool("grep"),
      tool("glob"),
      tool("edit"),
      tool("write"),
      tool("bash"),
    ])

    expect(items.map((item) => item.type === "activity" ? [item.kind, item.tools.length] : item.type)).toEqual([
      ["explore", 3],
      ["modify", 2],
      ["command", 1],
    ])
  })

  test("text and sub-agents remain independent timeline items", () => {
    const subAgent = tool("subagent") as Extract<TuiPart, { type: "tool" }>
    subAgent.subAgent = {
      profile: "finder",
      tools: [],
      tokensUsed: 0,
      tokenLimit: 1,
      done: false,
    }
    const items = groupMessageParts([
      tool("read"),
      { type: "text", text: "Found it." },
      subAgent,
      tool("grep"),
    ])

    expect(items.map((item) => item.type)).toEqual(["activity", "part", "part", "activity"])
  })
})

describe("ToolActivity progressive disclosure", () => {
  test("hides calls by default and reveals them when clicked", () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { ToolActivity } from "./src/tui/components/tool-activity-view.tsx";

      const tools = [
        { type: "tool", tool: "read", callId: "1", status: "completed", input: { path: "/src/a.ts" } },
        { type: "tool", tool: "grep", callId: "2", status: "completed", input: { pattern: "needle" } },
      ];
      const setup = await testRender(
        () => createComponent(ToolActivity, { kind: "explore", tools }),
        { width: 80, height: 10, useConsole: false },
      );
      await setup.renderOnce();
      const before = setup.captureCharFrame();
      await setup.mockMouse.click(10, 0);
      await setup.renderOnce();
      const after = setup.captureCharFrame();
      setup.renderer.destroy();
      console.log(JSON.stringify({ before, after }));
    `
    const proc = Bun.spawnSync({
      cmd: ["bun", "--preload", "./preload.ts", "-e", script],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!proc.success) throw new Error(proc.stderr.toString())
    const { before, after } = JSON.parse(proc.stdout.toString()) as { before: string; after: string }

    expect(before).toContain("• Explored the codebase")
    expect(before).toContain("▸")
    expect(before).not.toContain("Read /src/a.ts")
    expect(after).toContain("• Explored the codebase")
    expect(after).toContain("▾")
    expect(after).toContain("Read /src/a.ts")
    expect(after).toContain("Grep needle")
  })

  test("uses a live present-tense label while any call is active", () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { ToolActivity } from "./src/tui/components/tool-activity-view.tsx";
      const setup = await testRender(
        () => createComponent(ToolActivity, {
          kind: "modify",
          tools: [{ type: "tool", tool: "edit", callId: "1", status: "running", input: { path: "/src/a.ts" } }],
        }),
        { width: 80, height: 4, useConsole: false },
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
    const frame = JSON.parse(proc.stdout.toString()) as string
    expect(frame).toContain("• Modifying code…")
    expect(frame).toContain("▸")
  })
})
