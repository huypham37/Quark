// Tests for the config loader — loadConfig, setConfigField, resetConfigCache
//
// Strategy: point QUARK_CONFIG_DIR at a temp directory before importing the
// module, so all file I/O stays in a throwaway location and never touches the
// developer's real ~/.config/quark/config.yaml.

import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parse, stringify } from "yaml"

// config.ts resolves the directory per call, so pin it for every test.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "quark-config-test-"))
const previousConfigDir = process.env.QUARK_CONFIG_DIR
process.env.QUARK_CONFIG_DIR = tmpHome
const configDir = tmpHome
const configFile = path.join(configDir, "config.yaml")

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = previousConfigDir
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

const {
  loadConfig,
  setConfigField,
  resetConfigCache,
} = await import("../../packages/quark/src/config/config")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeConfig(data: Record<string, unknown>) {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configFile, stringify(data), "utf-8")
}

function removeConfig() {
  try {
    fs.unlinkSync(configFile)
  } catch {
    // Already gone
  }
}

function readConfigFile(): Record<string, unknown> {
  return parse(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Clean state between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.QUARK_CONFIG_DIR = tmpHome
  removeConfig()
  resetConfigCache()
})

// ---------------------------------------------------------------------------
// loadConfig — defaults
// ---------------------------------------------------------------------------
describe("loadConfig", () => {
  test("returns defaults when the config file is missing", () => {
    const config = loadConfig()
    expect(config.version).toBe(3)
    expect(config.models.small).toBe("openai/gpt-4o-mini")
    expect(config.maxSteps).toBe(100)
    expect(config.providers).toEqual({})
    expect(config.hideReadonlyTools).toBe(false)
    expect(config.summaryDetail).toBe("normal")
  })

  test("returns defaults when the config file has invalid YAML", () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configFile, ": : : invalid yaml {{{\n", "utf-8")

    expect(loadConfig().models.small).toBe("openai/gpt-4o-mini")
  })

  test("reads models.small from file", () => {
    writeConfig({ version: 2, models: { small: "anthropic/claude-sonnet" } })

    expect(loadConfig().models.small).toBe("anthropic/claude-sonnet")
  })

  test("falls back to the default for empty or non-string models.small", () => {
    writeConfig({ version: 2, models: { small: "" } })
    expect(loadConfig().models.small).toBe("openai/gpt-4o-mini")

    resetConfigCache()
    writeConfig({ version: 2, models: { small: true } })
    expect(loadConfig().models.small).toBe("openai/gpt-4o-mini")
  })

  test("rejects an incomplete model specification", () => {
    writeConfig({ version: 2, models: { small: "gpt-4o-mini" } })

    expect(() => loadConfig()).toThrow(/complete provider\/model specification/)
  })

  test("rejects a version 1 config with actionable guidance", () => {
    writeConfig({ small_model: "gpt-4.1-nano" })

    expect(() => loadConfig()).toThrow(/Version 1 configuration is no longer supported/)
  })

  test("rejects an unknown config version", () => {
    writeConfig({ version: 4, models: { small: "openai/gpt-5-mini" } })

    expect(() => loadConfig()).toThrow(/Unsupported config version "4"/)
  })

  test("reads default_agent from a version 3 config", () => {
    writeConfig({ version: 3, default_agent: "general", models: { small: "openai/gpt-5-mini" } })

    expect(loadConfig().version).toBe(3)
    expect(loadConfig().defaultAgent).toBe("general")
  })

  test("rejects a version 3 config that still carries inline profiles", () => {
    writeConfig({
      version: 3,
      models: { small: "openai/gpt-5-mini" },
      profiles: { coder: { tools: ["read"] } },
    })

    expect(() => loadConfig()).toThrow(/still has a "profiles" block/)
  })

  test("a version 2 config keeps its default profile as the default agent", () => {
    writeConfig({ version: 2, default_profile: "general", models: { small: "openai/gpt-5-mini" } })

    expect(loadConfig().defaultAgent).toBe("general")
  })

  test("rejects models that are not a mapping", () => {
    writeConfig({ version: 2, models: ["model-a", "model-b"] })

    expect(() => loadConfig()).toThrow(/models must contain small/)
  })

  test("does not expose unknown top-level fields as config", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, thinking_effort: "high" })

    const config = loadConfig() as unknown as Record<string, unknown>
    expect(config.thinking_effort).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// loadConfig — caching
// ---------------------------------------------------------------------------
describe("loadConfig caching", () => {
  test("returns cached result on second call", () => {
    writeConfig({ version: 2, models: { small: "openai/first-model" } })
    const first = loadConfig()
    expect(first.models.small).toBe("openai/first-model")

    // Change file on disk — loadConfig should still return cached
    writeConfig({ version: 2, models: { small: "openai/second-model" } })
    const second = loadConfig()
    expect(second.models.small).toBe("openai/first-model")
    expect(second).toBe(first) // Same object reference
  })

  test("resetConfigCache forces re-read", () => {
    writeConfig({ version: 2, models: { small: "openai/original" } })
    expect(loadConfig().models.small).toBe("openai/original")

    writeConfig({ version: 2, models: { small: "openai/updated" } })
    resetConfigCache()
    expect(loadConfig().models.small).toBe("openai/updated")
  })
})

// ---------------------------------------------------------------------------
// Branching defaults
// ---------------------------------------------------------------------------
describe("loadConfig — branching defaults", () => {
  test("defaults to a 0.90 threshold with auto enabled", () => {
    const config = loadConfig()
    expect(config.branching.threshold).toBe(0.90)
    expect(config.branching.auto).toBe(true)
  })

  test("clamps invalid thresholds and keeps valid overrides", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, branching: { threshold: 1.5, auto: false } })
    expect(loadConfig().branching).toEqual({ threshold: 0.9, auto: false })
  })
})

// ---------------------------------------------------------------------------
// max_steps validation
// ---------------------------------------------------------------------------
describe("loadConfig — max_steps validation", () => {
  test("defaults to 100 when max_steps is absent", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" } })

    expect(loadConfig().maxSteps).toBe(100)
  })

  test("accepts a positive integer", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, max_steps: 7 })

    expect(loadConfig().maxSteps).toBe(7)
  })

  test("rejects explicitly supplied non-integer or non-positive values", () => {
    for (const max_steps of [0, -1, 1.5, "10", true]) {
      writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, max_steps })
      resetConfigCache()

      expect(() => loadConfig()).toThrow(/max_steps must be a positive integer/)
    }
  })
})

// ---------------------------------------------------------------------------
// setConfigField
// ---------------------------------------------------------------------------
describe("summary_detail", () => {
  test("reads a valid level from file", () => {
    writeConfig({ version: 3, models: { small: "openai/gpt-5-mini" }, summary_detail: "loud" })

    expect(loadConfig().summaryDetail).toBe("loud")
  })

  test("falls back to normal for unknown or non-string levels", () => {
    for (const value of ["verbose", "", 3, null, true, { level: "quiet" }]) {
      resetConfigCache()
      writeConfig({ version: 3, models: { small: "openai/gpt-5-mini" }, summary_detail: value })
      expect(loadConfig().summaryDetail).toBe("normal")
    }
  })

  test("round-trips through setConfigField", () => {
    setConfigField("summaryDetail", "quiet")

    expect(readConfigFile().summary_detail).toBe("quiet")
    expect(loadConfig().summaryDetail).toBe("quiet")
  })

  test("absent from an older config without rewriting it as normal", () => {
    writeConfig({ version: 3, models: { small: "openai/gpt-5-mini" } })

    expect(loadConfig().summaryDetail).toBe("normal")
    expect(readConfigFile().summary_detail).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
describe("setConfigField", () => {
  test("creates the config file and directory if missing", () => {
    fs.rmSync(configDir, { recursive: true, force: true })

    setConfigField("maxSteps", 42)

    expect(fs.existsSync(configFile)).toBe(true)
    const data = readConfigFile()
    expect(data.version).toBe(3)
    expect(data.max_steps).toBe(42)
    expect((data.models as Record<string, unknown>).small).toBe("openai/gpt-4o-mini")
  })

  test("overwrites an existing field", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, max_steps: 10 })

    setConfigField("maxSteps", 25)

    expect(readConfigFile().max_steps).toBe(25)
  })

  test("preserves profiles and default_profile when writing an unrelated field", () => {
    writeConfig({
      version: 2,
      models: { small: "openai/gpt-5-mini" },
      default_profile: "general",
      profiles: { general: { name: "General", thinking_effort: "high" } },
      providers: { "quark-go": { base_url: "https://example.test/v1", api_key: "env:QUARK_GO_KEY" } },
    })

    setConfigField("hideReadonlyTools", true)

    const data = readConfigFile() as Record<string, any>
    expect(data.default_profile).toBe("general")
    expect(data.profiles.general.thinking_effort).toBe("high")
    expect(data.providers["quark-go"]).toEqual({
      base_url: "https://example.test/v1",
      api_key: "env:QUARK_GO_KEY",
    })
  })

  test("invalidates the cache so the next loadConfig reads fresh values", () => {
    writeConfig({ version: 2, models: { small: "openai/gpt-5-mini" }, max_steps: 10 })
    expect(loadConfig().maxSteps).toBe(10)

    setConfigField("maxSteps", 99)

    expect(loadConfig().maxSteps).toBe(99)
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
    writeConfig({ version: 2, models: { small: "openai/v1" } })
    loadConfig()

    writeConfig({ version: 2, models: { small: "openai/v2" } })
    resetConfigCache()

    expect(loadConfig().models.small).toBe("openai/v2")
  })
})
