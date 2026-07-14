import { describe, expect, test } from "bun:test"
import { __setModelsDevDataForTest } from "../../src/provider/models"
import { buildModelPickerOptions } from "../../src/tui/model-picker"
import { firstRunAuthMessage, formatAuthStatuses } from "../../src/tui/auth-status"

describe("descriptor-backed model picker", () => {
  test("renders canonical identity with provider auth and billing annotations", () => {
    __setModelsDevDataForTest({
      openrouter: {
        id: "openrouter",
        models: {
          "vendor/model": { id: "vendor/model", name: "Friendly Model", limit: { context: 10, output: 2 } },
        },
      },
    })
    const options = buildModelPickerOptions([
      "openrouter/vendor/model",
      "ollama/private-model",
      "company/private-model",
    ])
    expect(options[0]).toEqual({
      id: "openrouter/vendor/model",
      name: "Friendly Model",
      detail: "OpenRouter · API key · metered",
    })
    expect(options[1]?.detail).toBe("Ollama · no auth · free")
    expect(options[2]?.detail).toBe("company · metadata unknown")
    __setModelsDevDataForTest(null)
  })
})

describe("auth onboarding presentation", () => {
  test("shows origin and expiry without credentials", () => {
    const statuses = formatAuthStatuses([{
      providerId: "codex",
      state: "authenticated",
      origin: "machine-store",
      expiresAt: 1_800_000_000_000,
    }])
    expect(statuses[0]).toContain("machine-store")
    expect(statuses[0]).toContain("expires")
    expect(statuses[0]).not.toContain("token")
  })

  test("prompts first-run remediation only when selected provider is unavailable", () => {
    expect(firstRunAuthMessage("openrouter/model", [{
      providerId: "openrouter", state: "missing",
    }])).toBe("Authentication for openrouter is missing. Run: quark auth login openrouter")
    expect(firstRunAuthMessage("ollama/model", [{
      providerId: "ollama", state: "not-required",
    }])).toBeNull()
  })
})
