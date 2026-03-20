// Model metadata from models.dev — provides per-model token limits
//
// Fetches https://models.dev/api.json on startup, caches to disk.
// Used for compaction decisions instead of a hardcoded token limit.

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const CACHE_DIR = path.join(os.homedir(), ".config", "atom")
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

// ---------------------------------------------------------------------------
// getModelLimit — look up token limits for a model across all providers
//
// Searches github-copilot provider first, then falls back to any provider
// that has the model. Returns null if the model isn't found.
// ---------------------------------------------------------------------------
export function getModelLimit(modelId: string): ModelLimit | null {
  const data = getData()

  // Check github-copilot first (our primary provider)
  const copilot = data["github-copilot"]
  if (copilot?.models[modelId]) {
    return copilot.models[modelId].limit
  }

  // Fall back to any provider that has this model
  for (const provider of Object.values(data)) {
    const model = provider.models?.[modelId]
    if (model?.limit) return model.limit
  }

  return null
}

// Kick off initial fetch — expose promise so callers can await first load
export const ready = refresh()
setInterval(refresh, REFRESH_INTERVAL_MS).unref()
