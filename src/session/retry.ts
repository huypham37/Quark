// Retry logic — exponential backoff on retryable errors
//
// Classifies errors as retryable (429 rate limit, 5xx server errors, timeouts)
// vs fatal (4xx client errors, auth errors, aborts).

/**
 * Classify whether an error is retryable.
 *
 * Retryable:
 * - HTTP 429 (rate limited)
 * - HTTP 5xx (server errors)
 * - Network timeouts / connection errors
 * - "overloaded" errors from providers
 *
 * Not retryable:
 * - HTTP 4xx (except 429)
 * - Auth errors (401, 403)
 * - Abort errors
 * - Validation errors
 * - Unknown errors (safer to not retry)
 */
export function isRetryable(error: unknown): boolean {
  if (!error) return false

  // AbortError is never retryable
  if (error instanceof DOMException && error.name === "AbortError") return false
  if (error instanceof Error && error.name === "AbortError") return false

  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()

  // Check for status code in error object
  const status = extractStatus(error)
  if (status !== undefined) {
    if (status === 429) return true
    if (status >= 500 && status < 600) return true
    if (status >= 400 && status < 500) return false // 4xx (not 429) are fatal
  }

  // Check error message patterns
  if (lower.includes("rate limit") || lower.includes("too many requests")) return true
  if (lower.includes("overloaded") || lower.includes("capacity")) return true
  if (lower.includes("timeout") || lower.includes("timed out")) return true
  if (lower.includes("econnreset") || lower.includes("econnrefused")) return true
  if (lower.includes("socket hang up") || lower.includes("network")) return true
  if (lower.includes("502") || lower.includes("503") || lower.includes("504")) return true
  if (lower.includes("internal server error")) return true
  if (lower.includes("service unavailable")) return true
  if (lower.includes("bad gateway") || lower.includes("gateway timeout")) return true

  // Not retryable by default
  return false
}

/**
 * Extract HTTP status code from various error shapes.
 */
function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const e = error as any
  // Common patterns: error.status, error.statusCode, error.response.status
  if (typeof e.status === "number") return e.status
  if (typeof e.statusCode === "number") return e.statusCode
  if (e.response && typeof e.response.status === "number") return e.response.status
  if (e.data && typeof e.data.status === "number") return e.data.status
  return undefined
}

/**
 * Compute retry delay with exponential backoff + jitter.
 * attempt 0 → ~1s, 1 → ~2s, 2 → ~4s, 3 → ~8s, etc.
 * Capped at 30 seconds.
 */
export function retryDelay(attempt: number): number {
  const base = Math.pow(2, attempt) * 1000
  const jitter = Math.random() * 500
  return Math.min(base + jitter, 30_000)
}

/**
 * Async sleep that respects an AbortSignal.
 * Resolves after `ms` milliseconds, or rejects if the signal is aborted.
 */
export async function sleep(ms: number, abort?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    abort?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new Error("Aborted"))
    })
  })
}
