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

// LM Studio — local model server.
// Models are queried via GET /api/v1/models on startup and /reload-config.
// max_context_length is a static property of the downloaded model (does not
// require the model to be loaded).
const lmStudioCache = new Map<string, ModelLimit>()

export async function refreshLMStudio(baseUrl = "http://localhost:1234"): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      bus.emit("error", {
        sessionId: "",
        error: new Error(`LM Studio returned ${res.status}: ${res.statusText}`),
      })
      return
    }
    const data = await res.json() as {
      models: Array<{
        key: string
        type: string
        max_context_length: number
        loaded_instances?: Array<{ config?: { context_length?: number } }>
      }>
    }
    const { models } = data
    lmStudioCache.clear()
    for (const m of models) {
      if (m.type !== "llm") continue
      // Prefer user-set context_length from loaded instance, fall back to max
      const userSet = m.loaded_instances?.[0]?.config?.context_length
      const max = m.max_context_length
      const contextLen = userSet ?? max
      if (contextLen <= 0) continue
      const limit: ModelLimit = { context: contextLen, output: 0 }
      lmStudioCache.set(m.key, limit)
      const short = m.key.split("/").pop()
      if (short) lmStudioCache.set(short, limit)
    }
  } catch (err) {
    bus.emit("error", {
      sessionId: "",
      error: new Error("LM Studio not reachable at " + baseUrl),
    })
  }
}

// ---------------------------------------------------------------------------
// getModelLimit — look up token limits for a model.
//
// Priority:
//   1. lmstudio provider → lmStudioCache (async pre-filled)
//   2. Exact provider lookup in models.dev
//   3. Model-name fallback across all providers (for custom providers)
// ---------------------------------------------------------------------------
export function getModelLimit(modelSpec: string): ModelLimit | null {
  const parsed = parseModelSpec(modelSpec)

  if (!parsed.provider) {
    bus.emit("error", {
      sessionId: "",
      error: new Error(`Model spec "${modelSpec}" missing provider prefix`),
    })
    return null
  }

  // 0. LM Studio — check local cache first
  if (parsed.provider === "lmstudio") {
    const cached = lmStudioCache.get(parsed.model) ?? lmStudioCache.get(modelSpec)
    if (cached) {
      console.log("[models] %s → context=%d (lmstudio)", modelSpec, cached.context)
      return cached
    }
    bus.emit("error", {
      sessionId: "",
      error: new Error(`Model "${modelSpec}" not found in LM Studio. Is it downloaded?`),
    })
    return null
  }

  const data = getData()
  const providerId = PROVIDER_REMAP[parsed.provider] ?? parsed.provider

  // 1. Exact provider lookup
  const provider = data[providerId]
  const limit = provider?.models?.[parsed.model]?.limit

  if (limit) {
    console.log(
      "[models] %s → context=%d input=%s output=%d (provider=%s)",
      modelSpec,
      limit.context,
      limit.input ?? "n/a",
      limit.output,
      providerId,
    )
    return limit
  }

  // 2. Provider not in models.dev — fall back to model-name search
  if (!provider) {
    for (const [pid, pdata] of Object.entries(data)) {
      const model = pdata.models?.[parsed.model]
      if (model?.limit) {
        console.log(
          "[models] %s → context=%d input=%s output=%d (fallback via %s)",
          modelSpec,
          model.limit.context,
          model.limit.input ?? "n/a",
          model.limit.output,
          pid,
        )
        return model.limit
      }
    }
  }

  // Only emit bus error for providers that exist in models.dev but are
  // missing the specific model (genuine misconfiguration). Custom providers
  // not in models.dev silently return null — their limits are unknown.
  if (provider) {
    bus.emit("error", {
      sessionId: "",
      error: new Error(`Model "${parsed.model}" not found in provider "${providerId}"`),
    })
  }

  console.log("[models] %s → not found (returns 0)", modelSpec)
  return null
}

// Kick off initial fetch — expose promise so callers can await first load
export const ready = refresh()
setInterval(refresh, REFRESH_INTERVAL_MS).unref()
