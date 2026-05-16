// Statistics command — collect token usage data across all sessions
// and generate text-based charts for TUI display.
//
// Uses a disk cache (~/.config/quark/stats-cache.json) keyed by session
// timeUpdated to avoid replaying unchanged sessions. New or modified sessions
// are stream-parsed: only message + step-finish events are processed, skipping
// all text/tool/reasoning parts.

import { readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { scanSessionMetas } from "../storage/session-jsonl"
import { getSessionLogPath } from "../storage/session-path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelStats {
  input: number
  output: number
  messageCount: number
}

export interface DailyBucket {
  totalInput: number
  totalOutput: number
  byModel: Record<string, { input: number; output: number }>
}

export interface TokenStats {
  daily: Record<string, DailyBucket>
  modelTotals: Record<string, ModelStats>
  grandTotal: { input: number; output: number; messageCount: number }
  sessionCount: number
  dateRange: { earliest: string | null; latest: string | null }
}

/** Per-model, per-day token contribution from a single session. */
interface SessionDigest {
  modelId: string
  date: string // "YYYY-MM-DD"
  input: number
  output: number
}

/** On-disk cache structure. */
interface StatsCacheFile {
  v: 1
  sessions: Record<string, {
    timeUpdated: number
    digest: SessionDigest[]
  }>
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

const CACHE_PATH = join(homedir(), ".config", "quark", "stats-cache.json")

function readStatsCache(): StatsCacheFile {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    if (parsed.v === 1 && parsed.sessions) return parsed as StatsCacheFile
  } catch {
    // Missing or corrupt — start fresh
  }
  return { v: 1, sessions: {} }
}

function writeStatsCache(cache: StatsCacheFile): void {
  const tmpPath = CACHE_PATH + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(cache, null, 2))
  renameSync(tmpPath, CACHE_PATH)
}

// ---------------------------------------------------------------------------
// Streaming session digest extraction
// ---------------------------------------------------------------------------

/**
 * Stream-parse a single session's JSONL to extract per-model, per-day token
 * contributions. Only processes "message" and "step-finish" part events —
 * all other event types (text, tool, reasoning, session-update, etc.) are
 * skipped via a cheap substring check before JSON.parse.
 *
 * No PartRow objects are materialized; text content never enters memory.
 */
function extractSessionDigest(sessionId: string): SessionDigest[] {
  let raw: string
  try {
    raw = readFileSync(getSessionLogPath(sessionId), "utf-8")
  } catch {
    return []
  }

  // messageId → { modelId, providerId, role, timeCreated }
  const msgMeta = new Map<string, {
    modelId: string | null
    providerId: string | null
    role: string
    timeCreated: number
  }>()

  // messageId → cumulative { input, output } across all step-finish parts
  const msgTokens = new Map<string, { input: number; output: number }>()

  for (const line of raw.split("\n")) {
    if (!line) continue

    if (line.includes('"type":"message"')) {
      try {
        const evt = JSON.parse(line)
        if (evt.type === "message") {
          msgMeta.set(evt.messageId, {
            modelId: evt.modelId ?? null,
            providerId: evt.providerId ?? null,
            role: evt.role,
            timeCreated: evt.timeCreated,
          })
        }
      } catch {
        // Malformed line — skip
      }
    } else if (line.includes('"step-finish"')) {
      try {
        const evt = JSON.parse(line)
        if (evt.type === "part" && evt.partType === "step-finish") {
          const tokens = (evt.data as any)?.tokens
          if (tokens) {
            const input = tokens.input ?? 0
            const output = tokens.output ?? 0
            if (input > 0 || output > 0) {
              const prev = msgTokens.get(evt.messageId) ?? { input: 0, output: 0 }
              msgTokens.set(evt.messageId, {
                input: prev.input + input,
                output: prev.output + output,
              })
            }
          }
        }
      } catch {
        // Malformed line — skip
      }
    }
    // All other event types skipped
  }

  // Build digest entries from messages that have tokens
  const digests: SessionDigest[] = []
  for (const [messageId, tokens] of msgTokens) {
    const meta = msgMeta.get(messageId)
    if (!meta || meta.role !== "assistant") continue

    const modelId = meta.modelId || meta.providerId || "unknown"
    const date = new Date(meta.timeCreated).toISOString().slice(0, 10)

    digests.push({ modelId, date, input: tokens.input, output: tokens.output })
  }

  return digests
}

// ---------------------------------------------------------------------------
// Aggregate & collect (with cache)
// ---------------------------------------------------------------------------

function buildAggregate(
  sessions: Record<string, { digest: SessionDigest[] }>,
): TokenStats {
  const daily: Record<string, DailyBucket> = {}
  const modelTotals: Record<string, ModelStats> = {}
  const grandTotal = { input: 0, output: 0, messageCount: 0 }
  let earliestDate: string | null = null
  let latestDate: string | null = null

  for (const [, { digest }] of Object.entries(sessions)) {
    for (const entry of digest) {
      // Daily bucket
      if (!daily[entry.date]) {
        daily[entry.date] = { totalInput: 0, totalOutput: 0, byModel: {} }
      }
      daily[entry.date]!.totalInput += entry.input
      daily[entry.date]!.totalOutput += entry.output
      if (!daily[entry.date]!.byModel[entry.modelId]) {
        daily[entry.date]!.byModel[entry.modelId] = { input: 0, output: 0 }
      }
      daily[entry.date]!.byModel[entry.modelId]!.input += entry.input
      daily[entry.date]!.byModel[entry.modelId]!.output += entry.output

      // Model totals
      if (!modelTotals[entry.modelId]) {
        modelTotals[entry.modelId] = { input: 0, output: 0, messageCount: 0 }
      }
      modelTotals[entry.modelId]!.input += entry.input
      modelTotals[entry.modelId]!.output += entry.output
      modelTotals[entry.modelId]!.messageCount++

      // Grand total
      grandTotal.input += entry.input
      grandTotal.output += entry.output
      grandTotal.messageCount++

      // Date range
      if (earliestDate === null || entry.date < earliestDate) earliestDate = entry.date
      if (latestDate === null || entry.date > latestDate) latestDate = entry.date
    }
  }

  return {
    daily,
    modelTotals,
    grandTotal,
    sessionCount: Object.keys(sessions).length,
    dateRange: { earliest: earliestDate, latest: latestDate },
  }
}

export function collectStatistics(): TokenStats {
  const cache = readStatsCache()
  const sessions = scanSessionMetas()

  let dirty = false
  const currentIds = new Set<string>()

  for (const session of sessions) {
    currentIds.add(session.id)
    const stamp = cache.sessions[session.id]

    if (!stamp || stamp.timeUpdated !== session.timeUpdated) {
      dirty = true
      const digest = extractSessionDigest(session.id)
      cache.sessions[session.id] = { timeUpdated: session.timeUpdated, digest }
    }
  }

  // Remove deleted sessions
  for (const id of Object.keys(cache.sessions)) {
    if (!currentIds.has(id)) {
      dirty = true
      delete cache.sessions[id]
    }
  }

  if (dirty) {
    writeStatsCache(cache)
  }

  return buildAggregate(cache.sessions)
}

// ---------------------------------------------------------------------------
// Chart rendering
// ---------------------------------------------------------------------------

const CHART_WIDTH = 28
const BAR_FULL = "█"
const BAR_LIGHT = " "

const MODEL_COLORS: Record<string, string> = {
  "claude-sonnet-4.5": "🟠",
  "claude-sonnet-4": "🟠",
  "claude-opus-4.5": "🔴",
  "gpt-5-mini": "🟢",
  "gpt-5": "🟢",
  "gpt-4o": "🟢",
  "gemini-2.5-pro": "🔵",
  "gemini-2.5-flash": "🔵",
}

function modelEmoji(modelId: string): string {
  const lower = modelId.toLowerCase()
  for (const [key, emoji] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return emoji
  }
  if (lower.includes("claude")) return "🟠"
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) return "🟢"
  if (lower.includes("gemini")) return "🔵"
  if (lower.includes("qwen")) return "🟣"
  if (lower.includes("llama")) return "🟡"
  if (lower.includes("codestral") || lower.includes("mistral")) return "🔷"
  return "⚪"
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function barChart(value: number, max: number, width: number = CHART_WIDTH): string {
  if (max === 0) return BAR_LIGHT.repeat(width)
  const filled = Math.round((value / max) * width)
  return BAR_FULL.repeat(filled) + BAR_LIGHT.repeat(width - filled)
}

/**
 * Pad `s` on the right with spaces so its terminal display width equals `width`.
 * Uses Bun.stringWidth so emoji and wide chars count correctly.
 */
function padDisplay(s: string, width: number): string {
  const w = Bun.stringWidth(s)
  if (w >= width) return s
  return s + " ".repeat(width - w)
}

export function renderStatisticsChart(stats: TokenStats): string {
  const lines: string[] = []

  // Header
  lines.push("╭──────────────────────────────────────────────────────╮")
  lines.push("│              Quark Token Statistics                  │")
  lines.push("╰──────────────────────────────────────────────────────╯")
  lines.push("")

  // Empty state
  if (stats.grandTotal.messageCount === 0) {
    lines.push("  No token data found. Send some messages first!")
    return lines.join("\n")
  }

  // Summary
  const rangeText = stats.dateRange.earliest && stats.dateRange.latest
    ? `${stats.dateRange.earliest} → ${stats.dateRange.latest}`
    : "N/A"
  lines.push(`  Sessions: ${stats.sessionCount}  |  Messages: ${stats.grandTotal.messageCount}  |  Range: ${rangeText}`)
  lines.push(`  Total tokens: ${formatTokens(stats.grandTotal.input + stats.grandTotal.output)}  (in: ${formatTokens(stats.grandTotal.input)}, out: ${formatTokens(stats.grandTotal.output)})`)
  lines.push("")

  // Per-model table
  const models = Object.entries(stats.modelTotals).sort(
    (a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output),
  )

  if (models.length === 0) {
    lines.push("  No model data available.")
    return lines.join("\n")
  }

  // Find max for chart scaling
  const maxTotal = Math.max(...models.map(([, s]) => s.input + s.output), 1)

  // Unified box width: 64 display cells total (frame and rows match exactly).
  // Inner content area = 64 - 4 ("  │ ") - 2 (" │") = 58 cells.
  const INNER = 58
  const frame = (label: string, isTop: boolean): string => {
    const open = isTop ? "┌" : "└"
    const close = isTop ? "┐" : "┘"
    if (!label) return `  ${open}${"─".repeat(INNER + 2)}${close}`
    // "  ┌─ {label} " + dashes + "─┐"
    const head = `  ${open}─ ${label} `
    const headWidth = Bun.stringWidth(head)
    const dashCount = (INNER + 6) - headWidth - 2 // total target = INNER + 6 (for "  ┌─" + close)
    return `${head}${"─".repeat(Math.max(dashCount, 0))}${"─"}${close}`
  }
  const row = (inner: string): string => `  │ ${padDisplay(inner, INNER)} │`

  lines.push(frame("Per-Model Usage", true))
  for (const [model, s] of models) {
    const total = s.input + s.output
    const emoji = modelEmoji(model)
    const displayModel = model.length > 17 ? model.slice(0, 16) + "…" : model
    const chart = barChart(total, maxTotal, 24)
    lines.push(row(`${emoji} ${padDisplay(displayModel, 18)} ${formatTokens(total).padStart(7)} ${chart}`))
  }
  lines.push(frame("", false))
  lines.push("")

  // Detailed per-model breakdown
  lines.push(frame("Detailed Breakdown", true))
  lines.push(row(`Model                   Input      Output      Msgs`))
  lines.push(`  │${"─".repeat(INNER + 2)}│`)
  for (const [model, s] of models) {
    const emoji = modelEmoji(model)
    const displayModel = model.length > 17 ? model.slice(0, 16) + "…" : model
    lines.push(
      row(`${emoji} ${padDisplay(displayModel, 18)}   ${formatTokens(s.input).padStart(8)}   ${formatTokens(s.output).padStart(8)}   ${String(s.messageCount).padStart(6)}`),
    )
  }
  lines.push(frame("", false))

  // Daily trend (if we have >1 day of data)
  const days = Object.keys(stats.daily).sort()
  if (days.length > 1) {
    lines.push("")
    lines.push(frame("Daily Trend", true))

    const maxDaily = Math.max(...days.map((d) => stats.daily[d]!.totalInput + stats.daily[d]!.totalOutput), 1)

    for (const day of days.slice(-14)) { // Show last 14 days
      const bucket = stats.daily[day]!
      const dailyTotal = bucket.totalInput + bucket.totalOutput
      const chart = barChart(dailyTotal, maxDaily, 30)
      lines.push(row(`${day}  ${formatTokens(dailyTotal).padStart(7)}  ${chart}`))
    }
    lines.push(frame("", false))
  }

  lines.push("")

  return lines.join("\n")
}
