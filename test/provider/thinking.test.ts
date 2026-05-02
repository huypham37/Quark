import { describe, test, expect } from "bun:test"
import { getThinkingNormalizer, getThinkingLevels } from "../../src/provider/thinking"

describe("getThinkingLevels", () => {
  test("returns effort levels for gpt-5", () => {
    const levels = getThinkingLevels("gpt-5")
    expect(levels).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
  })

  test("returns effort levels for claude-opus-4-7", () => {
    const levels = getThinkingLevels("claude-opus-4-7")
    expect(levels).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
  })

  test("returns binary levels for qwen3-max", () => {
    const levels = getThinkingLevels("qwen3-max")
    expect(levels).toEqual(["none", "thinking"])
  })

  test("returns effort levels for deepseek", () => {
    const levels = getThinkingLevels("deepseek-v4-pro")
    expect(levels).toEqual(["none", "high", "max"])
  })

  test("returns null for unknown model", () => {
    const levels = getThinkingLevels("unknown-model")
    expect(levels).toBeNull()
  })

  test("prefix matches kimi- models", () => {
    const levels = getThinkingLevels("kimi-k2-thinking")
    expect(levels).toEqual(["none", "thinking"])
  })
})

describe("ThinkingNormalizer normalize", () => {
  test("qwen3-max uses correct providerOptions key", () => {
    const normalizer = getThinkingNormalizer("qwen3-max")
    normalizer.configure({ enabled: true, effort: "thinking" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeDefined()
    expect(result!.copilot).toEqual({ enable_thinking: true })
  })

  test("gpt-5 uses correct providerOptions key", () => {
    const normalizer = getThinkingNormalizer("gpt-5")
    normalizer.configure({ enabled: true, effort: "medium" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeDefined()
    expect(result!.copilot!.reasoningEffort).toBe("medium")
    expect(result!.copilot!.reasoningSummary).toBe("auto")
  })

  test("claude-opus-4-7 uses anthropic key", () => {
    const normalizer = getThinkingNormalizer("claude-opus-4-7")
    normalizer.configure({ enabled: true, effort: "low" })
    const result = normalizer.normalize("anthropic")
    expect(result).toBeDefined()
    expect(result!.anthropic!.thinking).toEqual({ type: "adaptive" })
    expect(result!.anthropic!.effort).toBe("low")
  })

  test("deepseek uses correct key with reasoningEffort and thinking toggle", () => {
    const normalizer = getThinkingNormalizer("deepseek-v4-pro")
    normalizer.configure({ enabled: true, effort: "high" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeDefined()
    expect(result!.copilot!.reasoningEffort).toBe("high")
    expect(result!.copilot!.thinking).toEqual({ type: "enabled" })
  })

  test("returns undefined when effort is none", () => {
    const normalizer = getThinkingNormalizer("gpt-5")
    normalizer.configure({ enabled: true, effort: "none" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeUndefined()
  })

  test("returns undefined for unknown model", () => {
    const normalizer = getThinkingNormalizer("unknown-model")
    normalizer.configure({ enabled: true, effort: "high" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeUndefined()
  })

  test("kimi uses correct key with thinking type enabled", () => {
    const normalizer = getThinkingNormalizer("kimi-k2.6")
    normalizer.configure({ enabled: true, effort: "thinking" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeDefined()
    expect(result!.copilot!.thinking).toEqual({ type: "enabled" })
  })

  test("binary model with effort=none returns undefined", () => {
    const normalizer = getThinkingNormalizer("qwen3-max")
    normalizer.configure({ enabled: true, effort: "none" })
    const result = normalizer.normalize("copilot")
    expect(result).toBeUndefined()
  })
})
