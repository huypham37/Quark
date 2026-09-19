import { afterAll, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { getContinuingToolCallId, getToolActivityKind, groupMessageParts, mergeToolActivityMessages } from "../../packages/quark/src/tui/components/tool-activity"
import type { TuiMessage, TuiPart } from "../../packages/quark/src/tui/state"

const ROOT = resolve(import.meta.dir, "../..")

// Config I/O for every render child below. `bun test` snapshots the environment
// at startup, so a child process does NOT inherit a parent-side env mutation —
// each spawn must pass this explicitly. Without it a settings write lands in the
// developer's real ~/.config/quark/config.yaml.
const CONFIG_DIR = `/tmp/quark-activity-test-${process.pid}`
process.env.QUARK_CONFIG_DIR = CONFIG_DIR

afterAll(() => {
  try { rmSync(CONFIG_DIR, { recursive: true, force: true }) } catch {}
})

function tool(tool: string, status: "pending" | "running" | "completed" | "error" = "completed"): TuiPart {
  return { type: "tool", tool, callId: tool, status, input: { path: `/${tool}.ts` } }
}

function assistant(id: string, parts: TuiPart[]): TuiMessage {
  return { id, role: "assistant", parts }
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

  test("merges exploration calls across adjacent tool-only assistant messages", () => {
    const messages = mergeToolActivityMessages([
      assistant("grep-step", [tool("grep"), tool("glob")]),
      assistant("read-step", [tool("read")]),
    ])

    expect(messages[1]).toBeUndefined()
    const items = groupMessageParts(messages[0]!.parts)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: "activity", kind: "explore" })
    expect((items[0] as any).tools).toHaveLength(3)
  })

  test("merges a leading tool run before a text boundary", () => {
    const messages = mergeToolActivityMessages([
      assistant("grep-step", [tool("grep")]),
      assistant("mixed-step", [tool("read"), { type: "text", text: "Found it" }, tool("read")]),
    ])

    expect(messages[0]!.parts.map((part) => part.type)).toEqual(["tool", "tool"])
    expect(groupMessageParts(messages[0]!.parts)).toMatchObject([{ type: "activity", kind: "explore" }])
    expect(messages[1]!.parts.map((part) => part.type)).toEqual(["text", "tool"])
  })

  test("merges any activity kind before a text boundary", () => {
    const messages = mergeToolActivityMessages([
      assistant("search-step", [tool("websearch")]),
      assistant("mixed-step", [tool("webfetch"), { type: "text", text: "Inspecting source" }]),
    ])

    expect(groupMessageParts(messages[0]!.parts)).toMatchObject([{ type: "activity", kind: "internet" }])
    expect(messages[1]!.parts).toMatchObject([{ type: "text" }])
  })

  test("does not merge across visible content or a steer divider", () => {
    const visibleBoundary = mergeToolActivityMessages([
      assistant("grep-step", [tool("grep")]),
      assistant("answer", [{ type: "text", text: "Found it" }]),
      assistant("read-step", [tool("read")]),
    ])
    expect(visibleBoundary.filter(Boolean)).toHaveLength(3)

    const dividerBoundary = mergeToolActivityMessages([
      assistant("grep-step", [tool("grep")]),
      assistant("read-step", [tool("read")]),
    ], new Set([1]))
    expect(dividerBoundary.filter(Boolean)).toHaveLength(2)
  })

  test("keeps the latest activity open until non-tool output starts", () => {
    const completedGrep = tool("grep") as Extract<TuiPart, { type: "tool" }>
    completedGrep.callId = "grep-call"

    expect(getContinuingToolCallId([
      assistant("grep-step", [completedGrep]),
      { ...assistant("next-step", []), streaming: true },
    ], true)).toBe("grep-call")

    expect(getContinuingToolCallId([
      assistant("grep-step", [completedGrep]),
      assistant("next-step", [{ type: "text", text: "Here is the answer" }]),
    ], true)).toBeNull()

    expect(getContinuingToolCallId([assistant("grep-step", [completedGrep])], false)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Summary detail levels
//
//   quiet   summary line only
//   normal  summary + tool call rows (no results)
//   loud    summary + tool call rows + results
//
// The level owns disclosure: there is no click-to-expand anymore.
// ---------------------------------------------------------------------------

interface FrameOptions {
  width?: number
  height?: number
  clicks?: number
  /** Runs before the render — used to switch on settings from the store. */
  prelude?: string
}

async function renderToolActivity(
  props: Record<string, unknown>,
  options: FrameOptions = {},
): Promise<string> {
  const { width = 80, height = 12, clicks = 0, prelude = "" } = options
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { ToolActivity } from "./packages/quark/src/tui/components/tool-activity-view.tsx";
    ${prelude}
    const setup = await testRender(
      () => createComponent(ToolActivity, ${JSON.stringify(props)}),
      { width: ${width}, height: ${height}, useConsole: false },
    );
    await setup.renderOnce();
    ${clicks > 0 ? `await setup.mockMouse.click(10, 0); await setup.renderOnce();` : ""}
    const frame = setup.captureCharFrame();
    setup.renderer.destroy();
    console.log(JSON.stringify(frame));
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./packages/quark/preload.ts", "-e", script],
    cwd: ROOT,
    // bun test snapshots the environment at startup, so a parent-side
    // `process.env.QUARK_CONFIG_DIR = ...` is NOT inherited by the child.
    // Pass it explicitly or the child writes the developer's real config.
    env: { ...process.env, QUARK_CONFIG_DIR: CONFIG_DIR },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString()) as string
}

const EXPLORE_TOOLS = [
  { type: "tool", tool: "read", callId: "1", status: "completed", input: { path: "/src/a.ts" } },
  { type: "tool", tool: "grep", callId: "2", status: "completed", input: { pattern: "needle" } },
]

const DIFF = [
  "@@ -1,2 +1,2 @@",
  " context",
  "-old line",
  "+new line",
  " tail",
].join("\n")

describe("summary detail levels", () => {
  test("quiet shows the summary line only", async () => {
    const frame = await renderToolActivity({ kind: "explore", tools: EXPLORE_TOOLS, level: "quiet" })

    expect(frame).toContain("• Explored the codebase")
    expect(frame).not.toContain("Read /src/a.ts")
    expect(frame).not.toContain("Grep needle")
    expect(frame).not.toContain("▾")
    expect(frame).not.toContain("▸")
  })

  test("quiet ignores clicks", async () => {
    const frame = await renderToolActivity(
      { kind: "explore", tools: EXPLORE_TOOLS, level: "quiet" },
      { clicks: 1 },
    )

    expect(frame).not.toContain("Read /src/a.ts")
    expect(frame).toContain("• Explored the codebase")
  })

  test("normal shows the tool call rows without their results", async () => {
    const frame = await renderToolActivity(
      {
        kind: "modify",
        tools: [{
          type: "tool",
          tool: "edit",
          callId: "1",
          status: "completed",
          input: { path: "/src/a.ts" },
          diff: DIFF,
        }],
        level: "normal",
      },
      { height: 16 },
    )

    expect(frame).toContain("• Modified code")
    expect(frame).toContain("Edit /src/a.ts")
    expect(frame).not.toContain("+new line")
    expect(frame).not.toContain("-old line")
    expect(frame).not.toContain("└── ")
  })

  test("loud adds the tool results", async () => {
    const frame = await renderToolActivity(
      {
        kind: "modify",
        tools: [{
          type: "tool",
          tool: "edit",
          callId: "1",
          status: "completed",
          input: { path: "/src/a.ts" },
          diff: DIFF,
        }],
        level: "loud",
      },
      { height: 20 },
    )

    expect(frame).toContain("• Modified code")
    expect(frame).toContain("Edit /src/a.ts")
    expect(frame).toContain("└── +1 -1")
    // DiffView distinguishes additions/removals by color only (no +/- prefix).
    expect(frame).toContain("new line")
    expect(frame).toContain("old line")
  })

  test("loud hides nothing: bash output is rendered too", async () => {
    const frame = await renderToolActivity(
      {
        kind: "command",
        tools: [{
          type: "tool",
          tool: "bash",
          callId: "1",
          status: "completed",
          input: { command: "bun test" },
          output: "12 pass, 0 fail",
        }],
        level: "loud",
      },
      { height: 16 },
    )

    expect(frame).toContain("Ran commands")
    expect(frame).toContain("Bash bun test")
    expect(frame).toContain("12 pass, 0 fail")
  })

  test("an active call keeps the present-tense label at every level", async () => {
    for (const level of ["quiet", "normal", "loud"]) {
      const frame = await renderToolActivity({
        kind: "modify",
        tools: [{ type: "tool", tool: "edit", callId: "1", status: "running", input: { path: "/src/a.ts" } }],
        level,
      }, { height: 10 })
      expect(frame).toContain("• Modifying code…")
    }
  })

  test("errors stay visible when the level hides the results", async () => {
    for (const level of ["quiet", "normal", "loud"]) {
      const frame = await renderToolActivity({
        kind: "command",
        tools: [{ type: "tool", tool: "bash", callId: "1", status: "error", input: { command: "false" }, error: "exit 1" }],
        level,
      }, { height: 10 })
      expect(frame).toContain("Ran commands")
      expect(frame).toContain("1 failed")
    }
  })
})

describe("ToolActivity inside App", () => {
  test("App renders cross-step exploration as one summary", async () => {
    const script = `
      import { testRender } from "@opentui/solid";
      import { createComponent } from "solid-js";
      import { App } from "./packages/quark/src/tui/components/App.tsx";
      import { bus } from "./packages/runner/src/session/events";

      const setup = await testRender(
        () => createComponent(App, {
          bus,
          initialSessionId: "activity-session",
          initialModelName: "smart",
          initialSkillCount: 0,
          onSubmit() {},
          onCancel() {},
          initialMessages: [
            { id: "grep-step", role: "assistant", parts: [
              { type: "tool", tool: "grep", callId: "1", status: "completed", input: { pattern: "src" } },
            ] },
            { id: "read-step", role: "assistant", parts: [
              { type: "tool", tool: "read", callId: "2", status: "completed", input: { path: "/src/tui/index.tsx" } },
            ] },
          ],
        }),
        { width: 80, height: 24, useConsole: false },
      );
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      setup.renderer.destroy();
      console.log(JSON.stringify(frame));
    `
    const proc = Bun.spawnSync({
      cmd: ["bun", "--preload", "./packages/quark/preload.ts", "-e", script],
      cwd: ROOT,
      env: { ...process.env, QUARK_CONFIG_DIR: CONFIG_DIR },
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!proc.success) throw new Error(proc.stderr.toString())
    const frame = JSON.parse(proc.stdout.toString()) as string
    // The default level (normal) groups both calls under a single summary and
    // lists the calls themselves.
    expect(frame.match(/Explored the codebase/g)).toHaveLength(1)
    expect(frame).toContain("Grep src")
    expect(frame).toContain("Read /src/tui/index.tsx")
  })
})

// ---------------------------------------------------------------------------
// Hide read-only tools
//
// Thins out the explore activity (read/grep/glob rows). Other activity kinds are
// untouched: a read-only websearch still belongs to "Searched the internet".
// ---------------------------------------------------------------------------
describe("hide read-only tools", () => {
  const HIDE = `
    const store = await import("./packages/quark/src/tui/settings-store.ts");
    store.applyHideReadonlyTools(true);
  `

  test("drops read/grep rows from the explore list", async () => {
    const frame = await renderToolActivity(
      { kind: "explore", tools: EXPLORE_TOOLS, level: "normal" },
      { height: 12, prelude: HIDE },
    )

    expect(frame).toContain("• Explored the codebase")
    expect(frame).not.toContain("Read /src/a.ts")
    expect(frame).not.toContain("Grep needle")
    // Nothing left behind the summary, so the disclosure indicator goes away too.
    expect(frame).not.toContain("▾")
  })

  test("leaves other activity kinds alone", async () => {
    const commandFrame = await renderToolActivity(
      {
        kind: "command",
        tools: [{ type: "tool", tool: "bash", callId: "1", status: "completed", input: { command: "bun test" }, output: "12 pass" }],
        level: "loud",
      },
      { height: 12, prelude: HIDE },
    )
    expect(commandFrame).toContain("Bash bun test")
    expect(commandFrame).toContain("12 pass")

    const internetFrame = await renderToolActivity(
      {
        kind: "internet",
        tools: [{ type: "tool", tool: "webfetch", callId: "1", status: "completed", input: { url: "https://example.test" } }],
        level: "normal",
      },
      { height: 12, prelude: HIDE },
    )
    expect(internetFrame).toContain("WebFetch https://example.test")
  })

  test("keeps a mixed explore run when it still has something to show", async () => {
    const frame = await renderToolActivity(
      {
        kind: "explore",
        tools: [
          { type: "tool", tool: "read", callId: "1", status: "completed", input: { path: "/src/a.ts" } },
          { type: "tool", tool: "look", callId: "2", status: "completed", input: { filePath: "/tmp/shot.png" } },
        ],
        level: "normal",
      },
      { height: 12, prelude: HIDE },
    )

    expect(frame).not.toContain("Read /src/a.ts")
    expect(frame).toContain("Look /tmp/shot.png")
    expect(frame).toContain("▾")
  })
})
