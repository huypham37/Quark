// Tests for the settings surface: the declarative row list, its search filter,
// and the palette mode that renders it.
//
// Config I/O is pinned to a temp directory (same strategy as
// test/config/config.test.ts) so the developer's real config is never touched.
//
// Note: `bun test` snapshots the environment at startup, so a child process does
// NOT inherit a parent-side `process.env` mutation. Every `Bun.spawnSync` below
// passes the temp directory explicitly — otherwise the render child would read
// (and on a write path, clobber) the developer's real config.

import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { resolve } from "node:path"

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "quark-settings-test-"))
const previousConfigDir = process.env.QUARK_CONFIG_DIR
process.env.QUARK_CONFIG_DIR = tmpHome

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = previousConfigDir
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

const { buildSettingRows, filterSettingRows } = await import("../../packages/quark/src/tui/settings-rows")
const { applySummaryDetail, applyHideReadonlyTools, syncSettingsFromConfig, summaryDetail, hideReadonlyTools } =
  await import("../../packages/quark/src/tui/settings-store")
const { loadConfig, resetConfigCache } = await import("../../packages/quark/src/config/config")

beforeEach(() => {
  resetConfigCache()
  try { fs.rmSync(path.join(tmpHome, "config.yaml"), { force: true }) } catch {}
  resetConfigCache()
  syncSettingsFromConfig()
})

// ---------------------------------------------------------------------------
// Row list
// ---------------------------------------------------------------------------
describe("buildSettingRows", () => {
  test("exposes summary detail as the first, editable row", () => {
    const rows = buildSettingRows()
    expect(rows[0]!.id).toBe("summary-detail")
    expect(rows[0]!.label).toBe("Summary detail")
    expect(rows[0]!.value()).toBe("normal")
    expect(typeof rows[0]!.cycle).toBe("function")
  })

  test("hide read-only tools renders on/off with a working toggle", () => {
    const row = buildSettingRows().find((item) => item.id === "hide-readonly-tools")!
    expect(row.value()).toBe("off")

    row.cycle!(1)
    expect(row.value()).toBe("on")
    expect(loadConfig().hideReadonlyTools).toBe(true)

    row.cycle!(-1)
    expect(row.value()).toBe("off")
    expect(loadConfig().hideReadonlyTools).toBe(false)
  })
})

describe("summary detail row", () => {
  test("cycles normal → loud → quiet → normal", () => {
    const row = buildSettingRows().find((item) => item.id === "summary-detail")!

    row.cycle!(1)
    expect(summaryDetail()).toBe("loud")
    row.cycle!(1)
    expect(summaryDetail()).toBe("quiet")
    row.cycle!(1)
    expect(summaryDetail()).toBe("normal")
  })

  test("cycles backwards past the start", () => {
    const row = buildSettingRows().find((item) => item.id === "summary-detail")!

    row.cycle!(-1)
    expect(summaryDetail()).toBe("quiet")
  })

  test("persists to config.yaml and survives a store re-sync", () => {
    applySummaryDetail("loud")

    const written = fs.readFileSync(path.join(tmpHome, "config.yaml"), "utf8")
    expect(written).toContain("summary_detail: loud")

    applySummaryDetail("normal")
    syncSettingsFromConfig()
    expect(summaryDetail()).toBe("normal")
  })

  test("re-sync adopts an externally edited level", () => {
    fs.writeFileSync(
      path.join(tmpHome, "config.yaml"),
      "version: 3\nmodels:\n  small: openai/gpt-5-mini\nsummary_detail: quiet\n",
      "utf8",
    )
    resetConfigCache()
    syncSettingsFromConfig()
    expect(summaryDetail()).toBe("quiet")
  })

  test("toggle state is restored from config", () => {
    applyHideReadonlyTools(true)
    syncSettingsFromConfig()
    expect(hideReadonlyTools()).toBe(true)
  })
})

describe("filterSettingRows", () => {
  test("empty query keeps every row in order", () => {
    expect(filterSettingRows(buildSettingRows(), "   ").map((row) => row.id))
      .toEqual(["summary-detail", "hide-readonly-tools"])
  })

  test("matches label, id, and keywords case-insensitively", () => {
    const rows = buildSettingRows()
    expect(filterSettingRows(rows, "SUMMARY").map((row) => row.id)).toEqual(["summary-detail"])
    expect(filterSettingRows(rows, "hide-readonly").map((row) => row.id)).toEqual(["hide-readonly-tools"])
    expect(filterSettingRows(rows, "glob").map((row) => row.id)).toEqual(["hide-readonly-tools"])
    expect(filterSettingRows(rows, "loud").map((row) => row.id)).toEqual(["summary-detail"])
  })

  test("returns nothing for an unmatched query", () => {
    expect(filterSettingRows(buildSettingRows(), "telemetry")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Palette rendering
// ---------------------------------------------------------------------------
const ROOT = resolve(import.meta.dir, "../..")

/**
 * Rows carry functions, so they cannot cross the process boundary as JSON.
 * `rowsExpression` is evaluated inside the render script instead.
 */
async function renderSettingsPalette(rowsExpression: string, query = "", selectedIndex = 0, width = 60, height = 14) {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { CommandPalette } from "./packages/quark/src/tui/components/command-palette.tsx";
    const settingsRows = ${rowsExpression};
    const setup = await testRender(() => createComponent(CommandPalette, {
      active: true,
      query: ${JSON.stringify(query)},
      entries: [],
      selectedIndex: ${selectedIndex},
      mode: "settings",
      settingsRows,
      onInput() {},
    }), { width: ${width}, height: ${height}, useConsole: false });
    await setup.renderOnce();
    console.log(JSON.stringify(setup.captureCharFrame().split("\\n")));
    setup.renderer.destroy();
  `
  const proc = Bun.spawnSync({
    cmd: ["bun", "--preload", "./packages/quark/preload.ts", "-e", script],
    cwd: ROOT,
    env: { ...process.env, QUARK_CONFIG_DIR: tmpHome },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!proc.success) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString()) as string[]
}

const BUILT_IN_ROWS = `(await import("./packages/quark/src/tui/settings-rows.ts")).buildSettingRows()`

describe("settings palette mode", () => {
  test("renders the title, rows, values, and the key hint", async () => {
    const frame = (await renderSettingsPalette(BUILT_IN_ROWS)).join("\n")

    expect(frame).toContain("Settings")
    expect(frame).toContain("Search settings")
    expect(frame).toContain("Summary detail")
    expect(frame).toContain("◀ normal ▶")
    expect(frame).toContain("Hide read-only tools")
    expect(frame).toContain("↑↓ select · ←→ change · Esc back")
    expect(frame).toContain("❯")
  })

  test("marks the selected row and moves the marker with selectedIndex", async () => {
    const rows = `[{ id: "a", label: "First setting", value: () => "one" }, { id: "b", label: "Second setting", value: () => "two" }]`
    const lines = await renderSettingsPalette(rows, "", 1)
    const selected = lines.find((line) => line.includes("Second setting"))!
    const unselected = lines.find((line) => line.includes("First setting"))!
    expect(selected).toContain("❯")
    expect(unselected).not.toContain("❯")
  })

  test("read-only rows render without the cycle arrows", async () => {
    const rows = `[{ id: "info", label: "Config file", value: () => "~/.config/quark/config.yaml" }]`
    const frame = (await renderSettingsPalette(rows)).join("\n")
    expect(frame).toContain("Config file")
    expect(frame).not.toContain("◀")
  })

  test("shows an empty state instead of the generic no-results copy", async () => {
    const frame = (await renderSettingsPalette("[]", "telemetry")).join("\n")
    expect(frame).toContain("No matching settings")
    expect(frame).not.toContain("No results")
  })
})
