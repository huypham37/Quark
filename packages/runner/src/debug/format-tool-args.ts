// Pretty-printer for tool-call arguments under `debug("tool")`.
//
// Renders `{ key: value, … }` on a single line with truncation and secret
// redaction. Designed for one-line stderr logs, not for replay or storage.
//
// Untruncated JSON is available via the separate `debug("tool:input-raw")`
// namespace — see src/cli.ts.

const SECRET_KEY_RE = /token|secret|key|password|auth/i
const MAX_STRING_LEN = 120
const MAX_ARRAY_ITEMS = 5

export function formatValue(v: unknown): string {
  if (v === null) return "null"
  if (v === undefined) return "undefined"
  if (typeof v === "string") {
    const lines = v.split("\n")
    const oneLine = lines.length > 1 ? `${lines[0]}\\n…(${lines.length} lines)` : v
    const truncated =
      oneLine.length > MAX_STRING_LEN
        ? `${oneLine.slice(0, MAX_STRING_LEN)}…(${oneLine.length} chars)`
        : oneLine
    return JSON.stringify(truncated)
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const shown = v.slice(0, MAX_ARRAY_ITEMS).map(formatValue)
    if (v.length > MAX_ARRAY_ITEMS) shown.push(`…(${v.length})`)
    return `[${shown.join(", ")}]`
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${k}: ${SECRET_KEY_RE.test(k) ? '"***"' : formatValue(val)}`,
    )
    return `{ ${entries.join(", ")} }`
  }
  return String(v)
}

export function formatArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input).map(
    ([k, v]) => `${k}: ${SECRET_KEY_RE.test(k) ? '"***"' : formatValue(v)}`,
  )
  return `{ ${entries.join(", ")} }`
}
