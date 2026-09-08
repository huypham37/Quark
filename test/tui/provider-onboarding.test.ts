import { describe, expect, test } from "bun:test"
import { firstRunAuthMessage, formatAuthStatuses } from "../../src/tui/auth-status"

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
