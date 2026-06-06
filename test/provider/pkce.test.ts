// Tests for PKCE (Proof Key for Code Exchange) utilities
// Uses Web Crypto API for cross-platform compatibility (Node 20+, Bun, browsers).
//
// TARGET SOURCE: src/provider/pkce.ts
// STATUS: Source file DOES NOT EXIST yet — these tests will FAIL at import time.

import { describe, test, expect } from "bun:test"
import { generatePKCE } from "../../src/provider/pkce"

// ---------------------------------------------------------------------------
// generatePKCE — produces verifier and challenge for OAuth PKCE flow
// ---------------------------------------------------------------------------
describe("generatePKCE", () => {
  test("returns object with verifier and challenge string properties", async () => {
    const result = await generatePKCE()

    expect(result).toBeDefined()
    expect(typeof result.verifier).toBe("string")
    expect(typeof result.challenge).toBe("string")
  })

  test("verifier is 43 characters (32 bytes base64url, no padding)", async () => {
    const { verifier } = await generatePKCE()

    expect(verifier.length).toBe(43)
  })

  test("challenge is 43 characters (SHA-256 hash, 32 bytes base64url)", async () => {
    const { challenge } = await generatePKCE()

    expect(challenge.length).toBe(43)
  })

  test("verifier contains only base64url-safe characters", async () => {
    const { verifier } = await generatePKCE()

    // base64url: A-Z, a-z, 0-9, -, _ (no + / =)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("challenge contains only base64url-safe characters", async () => {
    const { challenge } = await generatePKCE()

    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("two calls produce different verifiers (randomness)", async () => {
    const results = await Promise.all([generatePKCE(), generatePKCE()])

    expect(results[0]!.verifier).not.toBe(results[1]!.verifier)
    expect(results[0]!.challenge).not.toBe(results[1]!.challenge)
  })

  test("verifier and challenge are different values", async () => {
    const { verifier, challenge } = await generatePKCE()

    // The challenge is SHA-256 of the verifier, so they must differ
    expect(verifier).not.toBe(challenge)
  })

  test("challenge is deterministic for a given verifier", async () => {
    // Verify that if we manually compute SHA-256 of the verifier,
    // it matches the challenge. This validates the algorithm.
    const { verifier, challenge } = await generatePKCE()

    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashBytes = new Uint8Array(hashBuffer)

    // Manual base64url encoding
    let binary = ""
    for (const byte of hashBytes) {
      binary += String.fromCharCode(byte)
    }
    const expected = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")

    expect(challenge).toBe(expected)
  })
})
