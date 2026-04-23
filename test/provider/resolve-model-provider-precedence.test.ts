// Tests for resolveModel provider precedence
//
// Issue: When provider is explicitly set (e.g. "nvidia") but model string
// contains a slash (e.g. "minimaxai/minimax-m2.7"), the provider should NOT
// be overridden by the model's prefix. The model string should be passed
// as-is to the OpenAI-compatible endpoint.
//
// Example: provider="nvidia", model="minimaxai/minimax-m2.7"
//   → providerId: "nvidia"
//   → modelId: "minimaxai/minimax-m2.7" (sent in the API request)

import { describe, test, expect, spyOn, beforeEach, mock } from "bun:test"
import { parseModelSpec, getModelId, getModelSpec } from "../../src/config/config"

// ---------------------------------------------------------------------------
// parseModelSpec — splits at first slash, returns { provider, model }
// ---------------------------------------------------------------------------

describe("parseModelSpec", () => {
  test("splits single slash: provider/model", () => {
    const result = parseModelSpec("nvidia/minimax-m2.7")
    expect(result.provider).toBe("nvidia")
    expect(result.model).toBe("minimax-m2.7")
  })

  test("splits at first slash only for multi-slash strings", () => {
    const result = parseModelSpec("nvidia/minimaxai/minimax-m2.7")
    expect(result.provider).toBe("nvidia")
    expect(result.model).toBe("minimaxai/minimax-m2.7")
  })

  test("returns undefined provider when no slash", () => {
    const result = parseModelSpec("minimax-m2.7")
    expect(result.provider).toBeUndefined()
    expect(result.model).toBe("minimax-m2.7")
  })
})
