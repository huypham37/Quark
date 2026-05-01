// Model metadata from models.dev — provides per-model token limits
//
// Fetches https://models.dev/api.json on startup, caches to disk.
// Used for compaction decisions instead of a hardcoded token limit.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { parseModelSpec } from "../config/config"
import { bus } from "../session/events"

const CACHE_DIR = path.join(os.homedir(), ".config", "quark")
const CACHE_FILE = path.join(CACHE_DIR, "models.json")
const MODELS_URL = "https://models.dev/api.json"
const REFRESH_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export interface ModelLimit {
  context: number
  input?: number
  output: number
}

interface ModelsDevModel {
  id: string
  limit: { context: number; input?: number; output: number }
  [key: string]: unknown
}

interface ModelsDevProvider {
  id: string
  models: Record<string, ModelsDevModel>
  [key: string]: unknown
}

type ModelsDevData = Record<string, ModelsDevProvider>

let cached: ModelsDevData | null = null

function readCache(): ModelsDevData | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8")
    return JSON.parse(raw) as ModelsDevData
  } catch {
    return null
  }
}

function writeCache(data: ModelsDevData): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data), "utf-8")
}

export async function refresh(): Promise<void> {
  try {
    const res = await fetch(MODELS_URL, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return
    const data = JSON.parse(await res.text()) as ModelsDevData
    writeCache(data)
    cached = data
  } catch {
    // best-effort
  }
}

function getData(): ModelsDevData {
  if (cached) return cached
  cached = readCache() ?? ({} as ModelsDevData)
  return cached
}

// Known renames between user-facing provider IDs and models.dev IDs
const PROVIDER_REMAP: Record<string, string> = {
  copilot: "github-copilot",
  opencode: "opencode-go",
}

// ---------------------------------------------------------------------------
// getModelLimit — look up token limits for a model via exact provider lookup
//
// Takes a full "provider/model" string. Looks up the model in the specified
// provider only — no cross-provider fallback.
// ---------------------------------------------------------------------------
export function getModelLimit(modelSpec: string): ModelLimit | null {
  const parsed = parseModelSpec(modelSpec)

  if (!parsed.provider) {
    console.log("[models] missing provider prefix in model spec:", modelSpec)
    bus.emit("error", {
      sessionId: "",
      error: new Error(`Model spec "${modelSpec}" missing provider prefix`),
    })
    return null
  }

  const data = getData()
  const providerId = PROVIDER_REMAP[parsed.provider] ?? parsed.provider
  const remapped = providerId !== parsed.provider
  const provider = data[providerId]
  const limit = provider?.models?.[parsed.model]?.limit

  if (limit) {
    console.log(
      "[models] resolved limit for %s: context=%d input=%s output=%d (provider=%s%s)",
      modelSpec,
      limit.context,
      limit.input ?? "n/a",
      limit.output,
      providerId,
      remapped ? `, remapped from ${parsed.provider}` : "",
    )
    return limit
  }

  console.log(
    "[models] model %s not found in provider %s (available providers: %s)",
    parsed.model,
    providerId,
    Object.keys(data).join(", "),
  )
  bus.emit("error", {
    sessionId: "",
    error: new Error(
      `Model "${parsed.model}" not found in provider "${providerId}"`,
    ),
  })
  return null
}

// Kick off initial fetch — expose promise so callers can await first load
export const ready = refresh()
setInterval(refresh, REFRESH_INTERVAL_MS).unref()
