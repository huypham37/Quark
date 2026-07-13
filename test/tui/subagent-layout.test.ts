import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const error = "Model tried to call unavailable tool bash. Available tools: read, grep, glob, skill."

interface ToolFixture {
  tool: string
  callId: string
  status: "pending" | "awaiting_approval" | "running" | "completed" | "error"
  input: Record<string, unknown>
  error?: string
}

function fixture(tools: ToolFixture[]) {
  return {
    profile: "finder",
    modelName: "opencode/deepseek-v4-pro",
    prompt: "Get the current date, check the current git branch and git status.",
    tools,
    tokensUsed: 3900,
    tokenLimit: 1000000,
    done: true,
  }
}

function renderSubAgent(
  subAgent: ReturnType<typeof fixture>,
  width: number,
  height = 16,
  parentStatus: "running" | "error" = "error",
  wrapped = false,
  expanded = false,
): string[] {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { SubAgentView } from "./src/tui/components/sub-agent-view.tsx";
    import { MessageItem } from "./src/tui/components/message-item.tsx";

    const subAgent = ${JSON.stringify(subAgent)};
    const view = ${JSON.stringify(wrapped)}
      ? () => createComponent(MessageItem, {
          message: {
            id: "m1",
            role: "assistant",
            parts: [{
              type: "tool",
              tool: "bash",
              callId: "c1",
              status: ${JSON.stringify(parentStatus)},
              input: {},
              subAgent,
            }],
          },
        })
      : () => createComponent(SubAgentView, {
          subAgent,
          parentStatus: ${JSON.stringify(parentStatus)},
          defaultExpanded: ${JSON.stringify(expanded)},
        });

    const setup = await testRender(
      view,
      { width: ${width}, height: ${height}, useConsole: false },
    );
    await setup.renderOnce();
    console.log(JSON.stringify(setup.captureCharFrame().split("\\n")));
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

  return JSON.parse(proc.stdout.toString()) as string[]
}

describe("SubAgentView narrow layout", () => {
  test("keeps child tool prefixes and names together", () => {
    const subAgent = fixture([
      { tool: "bash", callId: "c1", status: "error", input: { command: "date +%Y-%m-%d_%H:%M:%S_%Z" }, error },
      { tool: "bash", callId: "c2", status: "error", input: { command: "git branch --show-current && echo STATUS && git status --short" }, error },
      { tool: "bash", callId: "c3", status: "error", input: { command: "cd /Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark && pm list-epics" }, error },
    ])
    subAgent.done = false
    const lines = renderSubAgent(subAgent, 72, 16, "running", false, true)

    const toolRows = lines.filter((line) => line.includes("● Bash"))
    expect(toolRows).toHaveLength(3)
    expect(lines.join("\n")).not.toContain("●Bas")
  })

  test("does not split the header status label", () => {
    const lines = renderSubAgent(fixture([
      { tool: "bash", callId: "c1", status: "error", input: { command: "git status --short" }, error },
    ]), 100, 10)

    expect(lines[0]).toMatch(/^╭─+╮\s*$/)
    expect(lines[1]).toContain("Finder failed")
    expect(lines[1]).toContain("opencode/deepseek-v4-pro")
  })

  test("starts completed cards collapsed", () => {
    const lines = renderSubAgent(fixture([
      { tool: "bash", callId: "c1", status: "completed", input: { command: "git status --short" } },
    ]), 72, 8, "running")

    expect(lines.join("\n")).toContain("▶ Task:")
    expect(lines.join("\n")).not.toContain("● Bash")
  })

  test("starts running cards collapsed by default", () => {
    const subAgent = fixture([
      { tool: "bash", callId: "c1", status: "running", input: { command: "git status --short" } },
    ])
    subAgent.done = false
    const lines = renderSubAgent(subAgent, 72, 8, "running")

    expect(lines.join("\n")).toContain("▶ Task:")
    expect(lines.join("\n")).not.toContain("● Bash")
  })

  test("renders a responsive meter with one-eighth-cell gaps", () => {
    const lines = renderSubAgent(fixture([]), 100, 8)
    const meter = lines.find((line) => line.includes("tokens")) ?? ""

    expect(meter).toContain("▉▉")
    expect(meter).toContain("3.9k / 1000k tokens (0.4%)")
  })

  test("shrinks the meter before widening a narrow card", () => {
    const lines = renderSubAgent(fixture([]), 100, 8)

    expect(lines[0]).toMatch(/^╭─+╮\s*$/)
    expect(lines[2]).toContain("3.9k / 1000k tokens (0.4%)")
  })

  test("meter cells are contiguous up to the label", () => {
    const lines = renderSubAgent(fixture([]), 120, 8)
    const line = lines.find((l) => l.includes("3.9k / 1000k tokens"))!
    const labelColumn = line.indexOf("3.9k / 1000k tokens")
    // Strip the leading "│ " border/padding and any trailing spaces before the label.
    const prefix = line.slice(2, labelColumn).trimEnd()

    expect(prefix).toMatch(/^▉+$/)
    expect(prefix.length).toBeGreaterThan(20)
  })

  test("card is flush against the left edge", () => {
    const lines = renderSubAgent(fixture([]), 50, 8, "error", true)

    expect(lines[0]).toMatch(/^╭─+╮\s*$/)
  })

  test("subagent card spans approximately half the assistant message pane width", () => {
    const width = 80
    const lines = renderSubAgent(fixture([]), width, 8, "error", true)

    // Assistant pane has marginLeft={1}, so content area starts at column 1
    const paneContentWidth = width - 1

    // The top border line looks like: " ╭────╮". Measure the card width.
    const borderLine = lines[0]!
    const leftBorder = borderLine.indexOf("╭")
    const rightBorder = borderLine.lastIndexOf("╮")
    expect(leftBorder).toBeGreaterThan(-1)
    expect(rightBorder).toBeGreaterThan(-1)

    const cardWidth = rightBorder - leftBorder + 1
    const ratio = cardWidth / paneContentWidth

    // Card should be roughly 50% of pane width (±15%)
    expect(ratio).toBeGreaterThan(0.35)
    expect(ratio).toBeLessThan(0.65)
  })
})
