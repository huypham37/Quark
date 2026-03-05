// Tests for Copilot OAuth device flow authentication
// Tests the token acquisition and refresh logic.

import { describe, test, expect } from "bun:test"
import {
  requestDeviceCode,
  pollForToken,
  normalizeDomain,
  type DeviceCodeResponse,
  type FetchFn,
} from "../../src/provider/copilot-auth"

// ---------------------------------------------------------------------------
// normalizeDomain — strips protocol and trailing slashes from URLs
// ---------------------------------------------------------------------------
describe("normalizeDomain", () => {
  test("strips https:// prefix", () => {
    expect(normalizeDomain("https://company.ghe.com")).toBe("company.ghe.com")
  })

  test("strips http:// prefix", () => {
    expect(normalizeDomain("http://company.ghe.com")).toBe("company.ghe.com")
  })

  test("strips trailing slash", () => {
    expect(normalizeDomain("https://company.ghe.com/")).toBe("company.ghe.com")
  })

  test("returns bare domain unchanged", () => {
    expect(normalizeDomain("company.ghe.com")).toBe("company.ghe.com")
  })

  test("returns null for empty string", () => {
    expect(normalizeDomain("")).toBeNull()
  })

  test("returns null for whitespace-only", () => {
    expect(normalizeDomain("   ")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// requestDeviceCode — initiates device flow with GitHub
// ---------------------------------------------------------------------------
describe("requestDeviceCode", () => {
  test("posts to correct URL for github.com", async () => {
    let capturedUrl = ""
    let capturedBody: any = null

    const mockFetch: FetchFn = async (url, init) => {
      capturedUrl = url.toString()
      capturedBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({
          device_code: "dc-123",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          interval: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    const result = await requestDeviceCode({
      domain: "github.com",
      fetch: mockFetch,
    })

    expect(capturedUrl).toBe("https://github.com/login/device/code")
    expect(capturedBody.scope).toBe("read:user")
    expect(capturedBody.client_id).toBeDefined()
    expect(result.device_code).toBe("dc-123")
    expect(result.user_code).toBe("ABCD-1234")
    expect(result.verification_uri).toBe("https://github.com/login/device")
  })

  test("posts to correct URL for enterprise domain", async () => {
    let capturedUrl = ""

    const mockFetch: FetchFn = async (url, _init) => {
      capturedUrl = url.toString()
      return new Response(
        JSON.stringify({
          device_code: "dc-456",
          user_code: "EFGH-5678",
          verification_uri: "https://enterprise.example.com/login/device",
          interval: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    await requestDeviceCode({
      domain: "enterprise.example.com",
      fetch: mockFetch,
    })

    expect(capturedUrl).toBe("https://enterprise.example.com/login/device/code")
  })

  test("throws on non-OK response", async () => {
    const mockFetch: FetchFn = async () =>
      new Response("Forbidden", { status: 403 })

    await expect(
      requestDeviceCode({
        domain: "github.com",
        fetch: mockFetch,
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// pollForToken — polls access token endpoint until success or failure
// ---------------------------------------------------------------------------
describe("pollForToken", () => {
  test("returns access token on success", async () => {
    let callCount = 0

    const mockFetch: FetchFn = async () => {
      callCount++
      if (callCount < 3) {
        return new Response(
          JSON.stringify({ error: "authorization_pending" }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({ access_token: "gho_token_123" }),
        { status: 200 },
      )
    }

    const result = await pollForToken({
      domain: "github.com",
      deviceCode: "dc-123",
      interval: 0, // No delay in tests
      fetch: mockFetch,
    })

    expect(result).toBe("gho_token_123")
    expect(callCount).toBe(3)
  })

  test("throws on unrecoverable error", async () => {
    const mockFetch: FetchFn = async () =>
      new Response(
        JSON.stringify({ error: "access_denied" }),
        { status: 200 },
      )

    await expect(
      pollForToken({
        domain: "github.com",
        deviceCode: "dc-123",
        interval: 0,
        fetch: mockFetch,
      }),
    ).rejects.toThrow()
  })

  test("throws on non-OK HTTP response", async () => {
    const mockFetch: FetchFn = async () =>
      new Response("Server Error", { status: 500 })

    await expect(
      pollForToken({
        domain: "github.com",
        deviceCode: "dc-123",
        interval: 0,
        fetch: mockFetch,
      }),
    ).rejects.toThrow()
  })

  test("respects abort signal", async () => {
    const controller = new AbortController()
    let callCount = 0

    const mockFetch: FetchFn = async () => {
      callCount++
      if (callCount === 2) controller.abort()
      return new Response(
        JSON.stringify({ error: "authorization_pending" }),
        { status: 200 },
      )
    }

    await expect(
      pollForToken({
        domain: "github.com",
        deviceCode: "dc-123",
        interval: 0,
        signal: controller.signal,
        fetch: mockFetch,
      }),
    ).rejects.toThrow()
  })
})
