import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

async function renderPalette(query: string, entries: unknown[], selectedIndex = 0, width = 80, height = 24) {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { CommandPalette } from "./src/tui/components/command-palette.tsx";
    const setup = await testRender(() => createComponent(CommandPalette, {
      active: true,
      query: ${JSON.stringify(query)},
      entries: ${JSON.stringify(entries)},
      selectedIndex: ${selectedIndex},
      onInput() {},
    }), { width: ${width}, height: ${height}, useConsole: false });
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
  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString()) as string[]
}

const model = {
  key: "model:gpt-5",
  type: "model",
  id: "gpt-5",
  label: "GPT-5",
  detail: "OpenAI",
  searchText: ["GPT-5", "gpt-5", "OpenAI"],
  isCurrent: true,
  action: { type: "model", modelId: "gpt-5" },
}

describe("command palette", () => {
  test("empty state is a centered search surface with a prompt", async () => {
    const lines = await renderPalette("", [])
    const visible = lines.filter((line) => line.trim())
    expect(visible).toHaveLength(3)
    expect(visible.join("\n")).toContain("> Search anything in Quark")
    expect(visible.join("\n")).not.toContain("No results")
    expect(visible.join("\n")).not.toContain("Command")
    expect(visible[0]!.indexOf("╭")).toBeGreaterThan(5)
  })

  test("renders textual types, details, state, and selected marker", async () => {
    const lines = await renderPalette("gpt", [model])
    const frame = lines.join("\n")
    expect(frame).toContain("Model")
    expect(frame).toContain("GPT-5")
    expect(frame).toContain("OpenAI · current")
    expect(frame).toContain("❯")
    expect(frame).toContain("╰──────────────────────────────────────────────────────────╯")
  })

  test("shows no-results only for a nonempty query", async () => {
    const lines = await renderPalette("missing", [])
    expect(lines.join("\n")).toContain("No results")
  })

  test("keeps a five-row result area for every nonempty query", async () => {
    const oneResult = (await renderPalette("gpt", [model])).filter((line) => line.trim())
    const fiveResults = (await renderPalette("gpt", Array.from({ length: 5 }, (_, index) => ({
      ...model,
      key: `model:${index}`,
      id: String(index),
    })))).filter((line) => line.trim())

    expect(oneResult[0]?.indexOf("╭")).toBe(fiveResults[0]?.indexOf("╭"))
    expect(oneResult.at(-1)?.indexOf("╰")).toBe(fiveResults.at(-1)?.indexOf("╰"))
    expect(oneResult.at(-1)).toBe(fiveResults.at(-1))
  })

  test("limits the viewport to five result rows", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      ...model,
      key: `model:${index}`,
      id: String(index),
      label: `Model ${index}`,
      action: { type: "model", modelId: String(index) },
    }))
    const lines = await renderPalette("model", entries, 7)
    const frame = lines.join("\n")
    expect(frame).not.toContain("Model 0")
    expect(frame).not.toContain("Model 1")
    expect(frame).not.toContain("Model 2")
    expect(frame).toContain("Model 7")
  })
})
