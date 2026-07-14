import { describe, expect, test } from "bun:test"
import {
  buildProviderOptions,
  getDefaultThinkingEffort,
  getThinkingLevels,
  getThinkingModes,
  ThinkingNormalizer,
} from "../../src/provider/thinking"
import { getThinkingCapability } from "../../src/provider/catalog"

describe("thinking capabilities", () => {
  test("catalog owns effort levels and modes", () => {
    expect(getThinkingLevels("gpt-5")).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    expect(getThinkingLevels("claude-opus-4-7")).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(getThinkingLevels("qwen3-max")).toEqual(["none", "thinking"])
    expect(getThinkingLevels("deepseek-v4-pro")).toEqual(["none", "high", "max"])
    expect(getThinkingLevels("kimi-k2-thinking")).toEqual(["none", "thinking"])
    expect(getThinkingLevels("unknown-model")).toBeNull()
    expect(getThinkingModes("codex/gpt-5.6-luna")).toEqual(["standard", "pro"])
    expect(getThinkingModes("copilot/gpt-5")).toBeNull()
    expect(getDefaultThinkingEffort("unknown-model")).toBe("none")
  })
})

describe("buildProviderOptions", () => {
  test("is pure and maps OpenAI-compatible options under the runtime key", () => {
    const config = { effort: "medium", mode: "standard", modeExplicit: false }
    const first = buildProviderOptions({
      providerOptionsKey: "copilot",
      modelId: "gpt-5",
      modelCapability: getThinkingCapability("gpt-5"),
      thinkingConfig: config,
    })
    const second = buildProviderOptions({
      providerOptionsKey: "company-router",
      modelId: "gpt-5",
      modelCapability: getThinkingCapability("gpt-5"),
      thinkingConfig: config,
    })
    expect(first?.copilot).toEqual({ reasoningEffort: "medium", reasoningSummary: "auto" })
    expect(second?.["company-router"]).toEqual({ reasoningEffort: "medium", reasoningSummary: "auto" })
    expect(config).toEqual({ effort: "medium", mode: "standard", modeExplicit: false })
  })

  test("maps native Anthropic and binary request shapes", () => {
    expect(buildProviderOptions({
      providerOptionsKey: "anthropic",
      modelId: "claude-opus-4-7",
      thinkingConfig: { effort: "low", mode: "standard", modeExplicit: false },
    })?.anthropic).toEqual({ thinking: { type: "adaptive" }, effort: "low" })
    expect(buildProviderOptions({
      providerOptionsKey: "copilot",
      modelId: "qwen3-max",
      thinkingConfig: { effort: "thinking", mode: "standard", modeExplicit: false },
    })?.copilot).toEqual({ enable_thinking: true })
  })

  test("maps deepseek and kimi overlays", () => {
    expect(buildProviderOptions({
      providerOptionsKey: "opencode",
      modelId: "deepseek-v4-pro",
      thinkingConfig: { effort: "high", mode: "standard", modeExplicit: false },
    })?.opencode).toEqual({ reasoningEffort: "high", thinking: { type: "enabled" } })
    expect(buildProviderOptions({
      providerOptionsKey: "copilot",
      modelId: "kimi-k2.6",
      thinkingConfig: { effort: "thinking", mode: "standard", modeExplicit: false },
    })?.copilot).toEqual({ thinking: { type: "enabled" } })
  })

  test("validates effort and explicit modes", () => {
    expect(() => buildProviderOptions({
      providerOptionsKey: "opencode",
      modelId: "deepseek-v4-flash",
      thinkingConfig: { effort: "xhigh", mode: "standard", modeExplicit: false },
    })).toThrow('Invalid thinking effort "xhigh"')
    expect(() => buildProviderOptions({
      providerOptionsKey: "copilot",
      modelId: "gpt-5",
      thinkingConfig: { effort: "high", mode: "pro", modeExplicit: true },
    })).toThrow("thinking_mode is not supported")
  })

  test("uses validated default/explicit modes and disables cleanly", () => {
    expect(buildProviderOptions({
      providerOptionsKey: "codex",
      modelId: "gpt-5.6-luna",
      thinkingConfig: { effort: "high", mode: "standard", modeExplicit: false },
    })?.codex?.reasoningMode).toBe("standard")
    expect(buildProviderOptions({
      providerOptionsKey: "codex",
      modelId: "gpt-5.6-luna",
      thinkingConfig: { effort: "high", mode: "pro", modeExplicit: true },
    })?.codex?.reasoningMode).toBe("pro")
    expect(buildProviderOptions({
      providerOptionsKey: "codex",
      modelId: "gpt-5.6-luna",
      thinkingConfig: { effort: "none", mode: "invalid", modeExplicit: true },
    })).toBeUndefined()
  })

  test("independent calls cannot leak thinking state across sessions", async () => {
    const [high, low] = await Promise.all([
      Promise.resolve(buildProviderOptions({
        providerOptionsKey: "codex",
        modelId: "gpt-5.6",
        thinkingConfig: { effort: "high", mode: "pro", modeExplicit: true },
      })),
      Promise.resolve(buildProviderOptions({
        providerOptionsKey: "codex",
        modelId: "gpt-5.6",
        thinkingConfig: { effort: "low", mode: "standard", modeExplicit: true },
      })),
    ])
    expect(high?.codex).toMatchObject({ reasoningEffort: "high", reasoningMode: "pro" })
    expect(low?.codex).toMatchObject({ reasoningEffort: "low", reasoningMode: "standard" })
  })
})

describe("ThinkingNormalizer compatibility", () => {
  test("is instance-scoped rather than process-global", () => {
    const first = new ThinkingNormalizer("gpt-5", { effort: "high" })
    const second = new ThinkingNormalizer("gpt-5", { effort: "low" })
    expect(first.normalize("copilot")?.copilot?.reasoningEffort).toBe("high")
    expect(second.normalize("copilot")?.copilot?.reasoningEffort).toBe("low")
  })
})
