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

function renderSubAgent(subAgent: ReturnType<typeof fixture>, width: number, height = 16): string[] {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { SubAgentView } from "./src/tui/components/sub-agent-view.tsx";

    const setup = await testRender(
      () => createComponent(SubAgentView, {
        subAgent: ${JSON.stringify(subAgent)},
        parentStatus: "error",
      }),
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
    const lines = renderSubAgent(fixture([
      { tool: "bash", callId: "c1", status: "error", input: { command: "date +%Y-%m-%d_%H:%M:%S_%Z" }, error },
      { tool: "bash", callId: "c2", status: "error", input: { command: "git branch --show-current && echo STATUS && git status --short" }, error },
      { tool: "bash", callId: "c3", status: "error", input: { command: "cd /Users/mac/01-CodeSpace/Personal-Lab/02-Experiment/Quark && pm list-epics" }, error },
    ]), 72)

    const treeRows = lines.filter((line) => /^\s*[├└]/.test(line))
    expect(treeRows).toHaveLength(3)
    for (const row of treeRows) expect(row).toContain("✗ Bash")
    expect(lines.join("\n")).not.toContain("✗Bas")
  })

  test("does not split the header status label", () => {
    const lines = renderSubAgent(fixture([
      { tool: "bash", callId: "c1", status: "error", input: { command: "git status --short" }, error },
    ]), 50, 10)

    expect(lines[0]).toContain("Finder failed")
  })
})
