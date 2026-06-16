# Test Document

**Timestamp:** 2026-06-07T00:00:00Z

This is a deliberately long line that will wrap when shown in the diff view of the TUI because it exceeds the width of a narrow terminal.

## Items

Item one
Item two
Item three
Item four

## Section B

The quick brown fox jumps over the lazy dog. Now is the time for all good men to come to the aid of their country.

## Configuration

export const CONFIG = {
  maxRetries: 5,
  timeout: 10000,
  enableLogging: true,
  enableMetrics: true,
  logLevel: "verbose" as const,
}

## Metrics

export function computeMetrics(input: { a: number; b: number; c: number; d: number; e: number }): { result: number; ok: boolean; duration: number; cached: boolean } {
  const start = performance.now()
  const sum = input.a + input.b + input.c + input.d + input.e
  return { result: sum, ok: sum > 0, duration: performance.now() - start, cached: false }
}
