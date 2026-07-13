import { describe, test, expect } from "bun:test"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")

function renderMeter(tokensUsed: number, tokenLimit: number, width = 80, height = 8) {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { SubAgentTokenMeter } from "./src/tui/components/sub-agent-token-meter.tsx";

    const setup = await testRender(
      () => createComponent(SubAgentTokenMeter, {
        tokensUsed: ${tokensUsed},
        tokenLimit: ${tokenLimit},
        color: "#00FF00",
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

describe("SubAgentTokenMeter", () => {
  test("renders the token label", () => {
    const lines = renderMeter(3900, 1000000)
    const text = lines.join("\n")

    expect(text).toContain("3.9k / 1000k tokens")
    expect(text).toContain("0%")
  })

  test("renders filled and empty meter cells", () => {
    const lines = renderMeter(500000, 1000000)
    const text = lines.join("\n")

    expect(text).toContain("▉")
    expect(text).toContain("50%")
  })

  test("renders a zero-token meter immediately", () => {
    const lines = renderMeter(0, 1000000)
    const text = lines.join("\n")

    expect(text).toContain("0 / 1000k tokens")
    expect(text).toContain("0%")
  })

  test("meter extends close to the token label", () => {
    const width = 120
    const lines = renderMeter(84200, 1000000, width, 8)
    const line = lines.find((l) => l.includes("84.2k / 1000k tokens"))!
    const labelColumn = line.indexOf("84.2k / 1000k tokens")
    const lastMeterCell = line.lastIndexOf("▉")

    // The last meter cell should sit just before the label (space + label).
    expect(labelColumn - lastMeterCell).toBeLessThan(5)
  })
})
