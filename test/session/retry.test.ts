import { describe, it, expect } from "bun:test"
import { isRetryable, retryDelay, sleep, isContextTooLong } from "../../src/session/retry"

describe("isRetryable", () => {
  it("returns false for null/undefined", () => {
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
  })

  it("returns false for AbortError", () => {
    const err = new DOMException("Aborted", "AbortError")
    expect(isRetryable(err)).toBe(false)
  })

  it("returns true for 429 rate limit", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns true for 500 server error", () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns true for 502 bad gateway", () => {
    const err = Object.assign(new Error("Bad Gateway"), { status: 502 })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns true for 503 service unavailable", () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns true for 504 gateway timeout", () => {
    const err = Object.assign(new Error("Gateway Timeout"), { status: 504 })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns false for 400 bad request", () => {
    const err = Object.assign(new Error("Bad Request"), { status: 400 })
    expect(isRetryable(err)).toBe(false)
  })

  it("returns false for 401 unauthorized", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 })
    expect(isRetryable(err)).toBe(false)
  })

  it("returns false for 403 forbidden", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 })
    expect(isRetryable(err)).toBe(false)
  })

  it("returns false for 404 not found", () => {
    const err = Object.assign(new Error("Not Found"), { status: 404 })
    expect(isRetryable(err)).toBe(false)
  })

  it("returns true for rate limit message without status code", () => {
    expect(isRetryable(new Error("rate limit exceeded"))).toBe(true)
    expect(isRetryable(new Error("Too Many Requests"))).toBe(true)
  })

  it("returns true for timeout errors", () => {
    expect(isRetryable(new Error("Request timed out"))).toBe(true)
    expect(isRetryable(new Error("Connection timeout"))).toBe(true)
  })

  it("returns true for network errors", () => {
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true)
    expect(isRetryable(new Error("ECONNREFUSED"))).toBe(true)
    expect(isRetryable(new Error("socket hang up"))).toBe(true)
  })

  it("returns true for overloaded/capacity errors", () => {
    expect(isRetryable(new Error("model is overloaded"))).toBe(true)
    expect(isRetryable(new Error("insufficient capacity"))).toBe(true)
  })

  it("returns true for statusCode property", () => {
    const err = Object.assign(new Error("Error"), { statusCode: 503 })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns true for nested response.status", () => {
    const err = Object.assign(new Error("Error"), {
      response: { status: 429 },
    })
    expect(isRetryable(err)).toBe(true)
  })

  it("returns false for unknown errors", () => {
    expect(isRetryable(new Error("something went wrong"))).toBe(false)
    expect(isRetryable(new Error("invalid parameter"))).toBe(false)
  })
})

describe("retryDelay", () => {
  it("returns increasing delays", () => {
    const d0 = retryDelay(0)
    const d1 = retryDelay(1)
    const d2 = retryDelay(2)
    // Base values: 1000, 2000, 4000 (plus jitter up to 500)
    expect(d0).toBeGreaterThanOrEqual(1000)
    expect(d0).toBeLessThan(1500)
    expect(d1).toBeGreaterThanOrEqual(2000)
    expect(d1).toBeLessThan(2500)
    expect(d2).toBeGreaterThanOrEqual(4000)
    expect(d2).toBeLessThan(4500)
  })

  it("caps at 30 seconds", () => {
    const d10 = retryDelay(10) // 2^10 * 1000 = 1024000 → capped at 30000
    expect(d10).toBeLessThanOrEqual(30000)
  })
})

describe("sleep", () => {
  it("resolves after the specified time", async () => {
    const start = Date.now()
    await sleep(50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  it("rejects on abort", async () => {
    const controller = new AbortController()
    const promise = sleep(5000, controller.signal)
    setTimeout(() => controller.abort(), 10)
    await expect(promise).rejects.toThrow("Aborted")
  })
})

// ---------------------------------------------------------------------------
// isContextTooLong (issue #89)
// ---------------------------------------------------------------------------

describe('isContextTooLong', () => {
  it('returns true for 400 error with context_length_exceeded message', () => {
    const err = Object.assign(new Error('context_length_exceeded: max context length is 128000'), { status: 400 })
    expect(isContextTooLong(err)).toBe(true)
  })

  it('returns true for error mentioning max context length', () => {
    const err = new Error('This model maximum context length is 128000 tokens')
    expect(isContextTooLong(err)).toBe(true)
  })

  it('returns true for error mentioning context window exceeded', () => {
    const err = new Error('context window exceeded')
    expect(isContextTooLong(err)).toBe(true)
  })

  it('returns true for error mentioning too many tokens', () => {
    const err = new Error('Request too large: too many tokens in the prompt')
    expect(isContextTooLong(err)).toBe(true)
  })

  it('returns true for prompt_too_long error', () => {
    const err = new Error('prompt_too_long: the prompt is too long for this model')
    expect(isContextTooLong(err)).toBe(true)
  })

  it('returns false for regular 400 error', () => {
    const err = Object.assign(new Error('Bad Request: invalid parameter'), { status: 400 })
    expect(isContextTooLong(err)).toBe(false)
  })

  it('returns false for 429 rate limit error', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 })
    expect(isContextTooLong(err)).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isContextTooLong(null)).toBe(false)
    expect(isContextTooLong(undefined)).toBe(false)
  })

  it('returns false for regular errors', () => {
    expect(isContextTooLong(new Error('something went wrong'))).toBe(false)
  })
})
