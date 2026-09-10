// Tests for the config loader — loadConfig, setConfigField, resetConfigCache
//
// Strategy: mock os.homedir() to point at a temp directory so all file I/O
// goes to a throwaway location. The config module computes CONFIG_DIR/FILE
// at import time from os.homedir(), so the mock must be set up before import.
//
// Defense-in-depth: Bun's mock.module may fail to catch modules that were
// already cached by the test runner. As a safety net, we back up and restore
// the real ~/.config/quark/config.yaml around the entire suite.

import { describe, test, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// ---------------------------------------------------------------------------
// Defense-in-depth: back up the real config file before the test suite
// ---------------------------------------------------------------------------
const REAL_CONFIG_DIR = path.join(os.homedir(), ".config", "quark")
const REAL_CONFIG_FILE = path.join(REAL_CONFIG_DIR, "config.yaml")
let realConfigBackup: Buffer | null = null

beforeAll(() => {
  try {
    if (fs.existsSync(REAL_CONFIG_FILE)) {
      realConfigBackup = fs.readFileSync(REAL_CONFIG_FILE)
    }
  } catch {
    // Config doesn't exist or can't be read — nothing to back up
  }
})

afterAll(() => {
  // Restore the real config file to its original state
  try {
    if (realConfigBackup) {
      fs.mkdirSync(REAL_CONFIG_DIR, { recursive: true })
      fs.writeFileSync(REAL_CONFIG_FILE, realConfigBackup)
    }
  } catch {
    // Best-effort restore — don't fail the suite if we can't restore
  }
  // Clean up temp dir
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

// ---------------------------------------------------------------------------
// Set up a temp directory that acts as $HOME for the config module
// ---------------------------------------------------------------------------
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "quark-config-test-"))
const configDir = path.join(tmpHome, ".config", "quark")
const configFile = path.join(configDir, "config.yaml")

// Mock os.homedir() BEFORE importing the config module
mock.module("os", () => ({
  ...os,
  homedir: () => tmpHome,
}))

// Now import the config module — it will compute CONFIG_DIR using our mocked homedir
const {
  loadConfig,
  setConfigField,
  resetConfigCache,
} = await import("../../src/config/config")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeConfig(data: Record<string, unknown>) {
  fs.mkdirSync(configDir, { recursive: true })
  // Write as YAML (config.ts reads YAML)
  const lines = Object.entries(data).map(([k, v]) => {
    if (Array.isArray(v)) {
      return `${k}:\n${v.map((item) => `  - ${item}`).join("\n")}`
    }
    return `${k}: ${v}`
  })
  fs.writeFileSync(configFile, lines.join("\n") + "\n", "utf-8")
}

function removeConfig() {
  try {
    fs.unlinkSync(configFile)
  } catch {
    // Already gone
  }
}

function readConfigFile(): Record<string, unknown> {
  const { parse } = require("yaml")
  const content = fs.readFileSync(configFile, "utf-8")
  return parse(content) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Clean state between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  removeConfig()
  resetConfigCache()
})

// ---------------------------------------------------------------------------
// loadConfig — defaults
// ---------------------------------------------------------------------------
describe("loadConfig", () => {
  test("returns the default small model when config file is missing", () => {
    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
    expect(config.small_model).toBe("openai/gpt-4o-mini")
  })

  test("returns defaults when config file has invalid YAML", () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configFile, ": : : invalid yaml {{{\n", "utf-8")

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
  })

  test("reads small_model from file", () => {
    writeConfig({ small_model: "gpt-4.1-nano" })

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4.1-nano")
    expect(config.small_model).toBe("openai/gpt-4.1-nano")
  })

  test("ignores legacy models input", () => {
    writeConfig({ models: ["model-a", "model-b"] })

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
    expect("models" in config).toBe(false)
  })

  test("falls back to default for empty string fields", () => {
    writeConfig({ small_model: "" })

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
  })

  test("falls back to default for non-string fields", () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configFile, "small_model: true\n", "utf-8")

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
  })

  test("reads the small model while ignoring legacy favorites", () => {
    writeConfig({
      models: ["a", "b", "c"],
      small_model: "tiny-model",
    })

    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/tiny-model")
    expect("models" in config).toBe(false)
  })

  test("does not expose top-level thinking fields as global defaults", () => {
    writeConfig({
      thinking_effort: "high",
      thinking_mode: "pro",
    })

    const config = loadConfig() as unknown as Record<string, unknown>
    expect(config.thinking_effort).toBeUndefined()
    expect(config.thinking_mode).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// loadConfig — caching
// ---------------------------------------------------------------------------
describe("loadConfig caching", () => {
  test("returns cached result on second call", () => {
    writeConfig({ small_model: "first-model" })
    const first = loadConfig()
    expect(first.modelConfig.small).toBe("openai/first-model")

    // Change file on disk — loadConfig should still return cached
    writeConfig({ small_model: "second-model" })
    const second = loadConfig()
    expect(second.modelConfig.small).toBe("openai/first-model")
    expect(second).toBe(first) // Same object reference
  })

  test("resetConfigCache forces re-read", () => {
    writeConfig({ small_model: "original" })
    const first = loadConfig()
    expect(first.modelConfig.small).toBe("openai/original")

    writeConfig({ small_model: "updated" })
    resetConfigCache()
    const second = loadConfig()
    expect(second.modelConfig.small).toBe("openai/updated")
  })
})

// ---------------------------------------------------------------------------
// model specs are always "provider/model" format
// ---------------------------------------------------------------------------
describe("model spec format", () => {
  test("small_model defaults include provider prefix", () => {
    const config = loadConfig()
    expect(config.modelConfig.small).toBe("openai/gpt-4o-mini")
  })

  test("reads model specs with provider prefix", () => {
    writeConfig({
      small_model: "opencode/deepseek-v4-pro",
    })
    const config = loadConfig()
    expect(config.modelConfig.small).toBe("opencode/deepseek-v4-pro")
  })
})

// ---------------------------------------------------------------------------
// setConfigField
// ---------------------------------------------------------------------------
describe("setConfigField", () => {
  test("creates config file and directory if missing", () => {
    // Ensure directory doesn't exist
    fs.rmSync(configDir, { recursive: true, force: true })

    setConfigField("small_model", "new-model")

    expect(fs.existsSync(configFile)).toBe(true)
    const data = readConfigFile()
    expect(data.version).toBe(2)
    expect((data.models as Record<string, unknown>).small).toBe("openai/new-model")
  })

  test("overwrites existing field", () => {
    writeConfig({ small_model: "old" })

    setConfigField("small_model", "new")

    const data = readConfigFile()
    expect((data.models as Record<string, unknown>).small).toBe("openai/new")
  })

  test("invalidates cache so next loadConfig reads fresh", () => {
    writeConfig({ small_model: "before" })
    const before = loadConfig()
    expect(before.modelConfig.small).toBe("openai/before")

    setConfigField("small_model", "after")
    const after = loadConfig()
    expect(after.modelConfig.small).toBe("openai/after")
  })

})

// ---------------------------------------------------------------------------
// loadConfig — branching defaults
// ---------------------------------------------------------------------------
describe("loadConfig — branching defaults", () => {
  test("default branching threshold is 0.90", () => {
    const config = loadConfig()
    expect(config.branching.threshold).toBe(0.90)
  })

  test("default branching auto is true", () => {
    const config = loadConfig()
    expect(config.branching.auto).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resetConfigCache
// ---------------------------------------------------------------------------
describe("resetConfigCache", () => {
  test("does not throw when called with no prior cache", () => {
    expect(() => resetConfigCache()).not.toThrow()
  })

  test("allows loadConfig to re-read after file change", () => {
    writeConfig({ small_model: "v1" })
    loadConfig()

    writeConfig({ small_model: "v2" })
    resetConfigCache()

    expect(loadConfig().modelConfig.small).toBe("openai/v2")
  })
})
