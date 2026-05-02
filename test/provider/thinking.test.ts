import { describe, test, expect } from "bun:test"
import { getThinkingNormalizer, getModelCapability } from "../../src/provider/thinking"

describe("getModelCapability", () => {
  test("returns adaptive for claude-opus-4-7", () => {
    const cap = getModelCapability("claude-opus-4-7")
    expect(cap).toBeDefined()
    expect(cap?.mode).toBe("adaptive")
  })

  test("returns effort for gpt-5", () => {
    const cap = getModelCapability("gpt-5")
    expect(cap).toBeDefined()
    expect(cap?.mode).toBe("effort")
  })

  test("returns native for qwen3-max", () => {
    const cap = getModelCapability("qwen3-max")
    expect(cap).toBeDefined()
    expect(cap?.mode).toBe("native")
  })
})

describe("ThinkingNormalizer normalize", () => {
  test("native mode uses openai providerOptions (not alibaba)", () => {
    const normalizer = getThinkingNormalizer("qwen3-max")
    normalizer.configure({ enabled: true, effort: "high" })
    const result = normalizer.normalize("openai-compatible")
    expect(result).toBeDefined()
    // After refactor, only openai providerOptions used
    expect(result!.alibaba).toBeUndefined()
    expect(result!.openai).toBeDefined()
  })

  test("effort mode uses openai providerOptions", () => {
    const normalizer = getThinkingNormalizer("gpt-5")
    normalizer.configure({ enabled: true, effort: "medium" })
    const result = normalizer.normalize("openai")
    expect(result).toBeDefined()
    expect(result!.openai).toBeDefined()
    expect(result!.openai?.reasoningEffort).toBe("medium")
  })

  test("adaptive mode uses anthropic providerOptions", () => {
    const normalizer = getThinkingNormalizer("claude-opus-4-7")
    normalizer.configure({ enabled: true, effort: "low" })
    const result = normalizer.normalize("anthropic")
    expect(result).toBeDefined()
    expect(result!.anthropic).toBeDefined()
    expect(result!.anthropic?.thinking).toEqual({ type: "adaptive" })
  })
})
