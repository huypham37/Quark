import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { searchPaletteEntries } from "../../src/tui/palette-index"

const ROOT = resolve(import.meta.dir, "../..")

async function renderPalette(
  query: string,
  entries: unknown[],
  selectedIndex = 0,
  width = 80,
  height = 24,
  mode: import("../../src/tui/components/command-palette").PaletteMode = "search",
  sessionRows: unknown[] = [],
  connect?: unknown,
) {
  const script = `
    import { testRender } from "@opentui/solid";
    import { createComponent } from "solid-js";
    import { CommandPalette } from "./src/tui/components/command-palette.tsx";
    const setup = await testRender(() => createComponent(CommandPalette, {
      active: true,
      query: ${JSON.stringify(query)},
      entries: ${JSON.stringify(entries)},
      selectedIndex: ${selectedIndex},
      mode: ${JSON.stringify(mode)},
      sessionRows: ${JSON.stringify(sessionRows)},
      sessionAction: "browse",
      connect: ${JSON.stringify(connect)},
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

  test("renders models in the centered palette surface", async () => {
    const lines = await renderPalette("", [model], 0, 80, 24, "models")
    const frame = lines.join("\n")

    expect(frame).toContain("Models")
    expect(frame).toContain("Search models")
    expect(frame).toContain("GPT-5")
    expect(frame).toContain("current")
  })

  test("renders skills in the centered palette surface", async () => {
    const lines = await renderPalette("", [{ ...model, type: "skill", key: "skill:teaching", id: "teaching", label: "teaching", action: { type: "skill", skillId: "teaching" } }], 0, 80, 24, "skills")
    const frame = lines.join("\n")

    expect(frame).toContain("Skills")
    expect(frame).toContain("Search skills")
    expect(frame).toContain("teaching")
    expect(lines.find((line) => line.includes("╭"))!.indexOf("╭")).toBeGreaterThan(5)
  })

  test("renders provider selection through the standard entity picker", async () => {
    const entries = [
      { ...model, key: "provider:openai", type: "provider", id: "openai", label: "OpenAI", detail: "API key · missing", action: { type: "provider", providerId: "openai" } },
      { ...model, key: "provider:ollama", type: "provider", id: "ollama", label: "Ollama", detail: "No authentication required · not-required", action: { type: "provider", providerId: "ollama" } },
    ]
    const lines = await renderPalette("", entries, 0, 80, 24, "connect-providers")
    const frame = lines.join("\n")
    expect(frame).toContain("Connect a provider")
    expect(frame).toContain("Search providers")
    expect(frame).toContain("Provider")
    expect(frame).toContain("OpenAI")
    expect(frame).toContain("API key · missing")
  })

  test("filters providers through the standard search input", async () => {
    const entries = [
      { ...model, key: "provider:openai", type: "provider", id: "openai", label: "OpenAI", detail: "API key · missing", action: { type: "provider", providerId: "openai" } },
      { ...model, key: "provider:deepseek", type: "provider", id: "deepseek", label: "DeepSeek", detail: "API key · authenticated", action: { type: "provider", providerId: "deepseek" } },
    ]
    const lines = await renderPalette("deep", searchPaletteEntries(entries, "deep"), 0, 80, 24, "connect-providers")
    const frame = lines.join("\n")

    expect(frame).toContain("Search providers")
    expect(frame).toContain("DeepSeek")
    expect(frame).not.toContain("OpenAI")
  })

  test("uses the same fixed result viewport as other entity pickers", async () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      ...model,
      key: `provider:${index}`,
      type: "provider",
      id: String(index),
      label: `Provider ${index}`,
      action: { type: "provider", providerId: String(index) },
    }))
    const lines = await renderPalette("", entries, 0, 80, 24, "connect-providers")

    expect(lines.join("\n")).not.toContain("Provider 5")
    expect(lines.join("\n")).not.toContain("Provider 6")
  })

  test("masks API-key display and never renders the key", async () => {
    const secret = "sk-super-secret"
    const lines = await renderPalette(secret, [], 0, 80, 24, "connect-api-key", [], {
      providers: [], providerName: "OpenAI", apiKeyLength: secret.length,
    })
    const frame = lines.join("\n")
    expect(frame).toContain("•••••••••••••••")
    expect(frame).not.toContain(secret)
  })

  test("renders device authorization progress", async () => {
    const lines = await renderPalette("", [], 0, 80, 24, "connect-authorizing", [], {
      providers: [], providerName: "GitHub Copilot",
      deviceCode: { verificationUri: "https://github.com/login/device", userCode: "ABCD-1234" },
    })
    const frame = lines.join("\n")
    expect(frame).toContain("https://github.com/login/device")
    expect(frame).toContain("ABCD-1234")
    expect(frame).toContain("Waiting for authorization")
  })

  test("does not call an environment-managed custom provider ready", async () => {
    const lines = await renderPalette("", [], 0, 80, 24, "connect-result", [], {
      providers: [],
      result: { kind: "info", message: "Set DEEPSEEK_API_KEY to change this provider's API key" },
    })
    const frame = lines.join("\n")
    expect(frame).toContain("Set DEEPSEEK_API_KEY")
    expect(frame).toContain("Update the environment variable outside Quark")
    expect(frame).not.toContain("Authentication is ready")
  })

  test("renders the session picker in the centered palette surface", async () => {
    const rows = [{
      type: "session",
      id: "session-1",
      label: "Continue command palette",
      detail: "current · 2 files · now",
      current: true,
      root: true,
      guides: [],
      connector: "plain",
    }]
    const lines = await renderPalette("", [], 0, 80, 24, "sessions", rows)
    const frame = lines.join("\n")

    expect(frame).toContain("Sessions")
    expect(frame).toContain("Search sessions")
    expect(frame).toContain("Continue command palette")
    expect(frame).toContain("Enter open")
    expect(lines.find((line) => line.includes("╭"))!.indexOf("╭")).toBeGreaterThan(5)
  })
})
