// Tests for Tab-to-cycle-model feature
//
// Extracts and tests the model cycling logic used in App.tsx keyboard handler.
// The logic cycles through available models when Tab is pressed (no dropdown,
// no pending images, agent not running).

import { describe, test, expect } from "bun:test"

import { getNextModel, getPrevModel } from "../../src/tui/model-cycle"

describe("getNextModel: Tab key model cycling logic", () => {
  test("cycles from first model to second model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getNextModel(models, "gpt-4")
    expect(result).toBe("claude-3.5")
  })

  test("cycles from middle model to next model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getNextModel(models, "claude-3.5")
    expect(result).toBe("gemini-pro")
  })

  test("wraps around from last model to first model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getNextModel(models, "gemini-pro")
    expect(result).toBe("gpt-4")
  })

  test("when current model is not found in list, cycles to first model (index -1 + 1 = 0)", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
    ]
    const result = getNextModel(models, "unknown-model")
    expect(result).toBe("gpt-4")
  })

  test("returns null when only one model available (no cycling possible)", () => {
    const models = [{ id: "gpt-4", name: "GPT-4" }]
    const result = getNextModel(models, "gpt-4")
    expect(result).toBeNull()
  })

  test("returns null when model list is empty", () => {
    const models: { id: string; name: string }[] = []
    const result = getNextModel(models, "any-model")
    expect(result).toBeNull()
  })

  test("handles two models cycling correctly", () => {
    const models = [
      { id: "fast", name: "Fast Model" },
      { id: "smart", name: "Smart Model" },
    ]
    
    // First to second
    expect(getNextModel(models, "fast")).toBe("smart")
    
    // Second wraps to first
    expect(getNextModel(models, "smart")).toBe("fast")
  })

  test("handles model IDs with special characters", () => {
    const models = [
      { id: "gpt-4-turbo-2024-04-09", name: "GPT-4 Turbo" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5" },
    ]
    const result = getNextModel(models, "gpt-4-turbo-2024-04-09")
    expect(result).toBe("claude-3-5-sonnet-20241022")
  })
})

describe("getPrevModel: Shift+Tab key model cycling logic", () => {
  test("cycles from last model to second-to-last model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getPrevModel(models, "gemini-pro")
    expect(result).toBe("claude-3.5")
  })

  test("cycles from middle model to previous model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getPrevModel(models, "claude-3.5")
    expect(result).toBe("gpt-4")
  })

  test("wraps around from first model to last model", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getPrevModel(models, "gpt-4")
    expect(result).toBe("gemini-pro")
  })

  test("when current model is not found in list, cycles to second-to-last model (index -1 wraps via formula)", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]
    const result = getPrevModel(models, "unknown-model")
    expect(result).toBe("claude-3.5")
  })

  test("returns null when only one model available (no cycling possible)", () => {
    const models = [{ id: "gpt-4", name: "GPT-4" }]
    const result = getPrevModel(models, "gpt-4")
    expect(result).toBeNull()
  })

  test("returns null when model list is empty", () => {
    const models: { id: string; name: string }[] = []
    const result = getPrevModel(models, "any-model")
    expect(result).toBeNull()
  })

  test("handles two models cycling correctly", () => {
    const models = [
      { id: "fast", name: "Fast Model" },
      { id: "smart", name: "Smart Model" },
    ]

    // Second to first
    expect(getPrevModel(models, "smart")).toBe("fast")

    // First wraps to second
    expect(getPrevModel(models, "fast")).toBe("smart")
  })

  test("handles model IDs with special characters", () => {
    const models = [
      { id: "gpt-4-turbo-2024-04-09", name: "GPT-4 Turbo" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5" },
    ]
    const result = getPrevModel(models, "claude-3-5-sonnet-20241022")
    expect(result).toBe("gpt-4-turbo-2024-04-09")
  })

  test("getNextModel and getPrevModel are inverse operations", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5", name: "Claude 3.5 Sonnet" },
      { id: "gemini-pro", name: "Gemini Pro" },
    ]

    // Going forward then backward returns to the original model
    const next = getNextModel(models, "claude-3.5")
    expect(getPrevModel(models, next!)).toBe("claude-3.5")

    // Going backward then forward returns to the original model
    const prev = getPrevModel(models, "claude-3.5")
    expect(getNextModel(models, prev!)).toBe("claude-3.5")
  })
})
