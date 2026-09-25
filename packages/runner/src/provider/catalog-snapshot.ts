import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"

export const CATALOG_SNAPSHOT_VERSION = 1 as const
export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json"
export const DEFAULT_CATALOG_SNAPSHOT_PATH = path.join(
  os.homedir(),
  ".config",
  "quark",
  "models-catalog.json",
)

const nonEmptyString = z.string().min(1)
const nonNegativeNumber = z.number().finite().min(0)
const dateString = z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/)
const sourceTimestamp = z.union([
  nonNegativeNumber,
  z.string().datetime({ offset: true }),
])

const ReasoningOptionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggle") }),
  z.object({
    type: z.literal("effort"),
    values: z.array(z.union([z.string(), z.null()])),
  }),
  z.object({
    type: z.literal("budget_tokens"),
    min: z.number().finite().min(-1).optional(),
    max: nonNegativeNumber.optional(),
  }),
]).refine(
  (option) =>
    option.type !== "budget_tokens" ||
    option.min === undefined ||
    option.max === undefined ||
    option.min <= option.max,
  "Reasoning budget minimum cannot exceed maximum",
)

const CostTierSchema = z.object({
  tier: z.object({
    type: z.string().optional(),
    size: nonNegativeNumber,
  }),
  input: nonNegativeNumber,
  output: nonNegativeNumber,
  reasoning: nonNegativeNumber.optional(),
  cache_read: nonNegativeNumber.optional(),
  cache_write: nonNegativeNumber.optional(),
  input_audio: nonNegativeNumber.optional(),
  output_audio: nonNegativeNumber.optional(),
})

type CatalogCostInput = {
  input: number
  output: number
  reasoning?: number
  cache_read?: number
  cache_write?: number
  input_audio?: number
  output_audio?: number
  context_over_200k?: CatalogCostInput
  tiers?: z.infer<typeof CostTierSchema>[]
}

const CostSchema: z.ZodType<CatalogCostInput> = z.object({
  input: nonNegativeNumber,
  output: nonNegativeNumber,
  reasoning: nonNegativeNumber.optional(),
  cache_read: nonNegativeNumber.optional(),
  cache_write: nonNegativeNumber.optional(),
  input_audio: nonNegativeNumber.optional(),
  output_audio: nonNegativeNumber.optional(),
  context_over_200k: z.lazy(() => CostSchema).optional(),
  tiers: z.array(CostTierSchema).optional(),
})

const LimitSchema = z.object({
  context: nonNegativeNumber,
  input: nonNegativeNumber.optional(),
  output: nonNegativeNumber,
})

const ModalitiesSchema = z.object({
  input: z.array(nonEmptyString),
  output: z.array(nonEmptyString),
})

const InterleavedSchema = z.union([
  z.literal(true),
  z.object({ field: nonEmptyString }),
])

const ModelSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  family: nonEmptyString.optional(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  reasoning_options: z.array(ReasoningOptionSchema).optional(),
  tool_call: z.boolean(),
  // `tool_call` is the current models.dev field. Keep `tools` compatible with
  // catalog snapshots produced by clients that use the more descriptive name.
  tools: z.union([z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  structured_output: z.boolean().optional(),
  temperature: z.boolean().optional(),
  knowledge: dateString.optional(),
  release_date: dateString,
  last_updated: dateString,
  modalities: ModalitiesSchema,
  open_weights: z.boolean(),
  limit: LimitSchema,
  cost: CostSchema.optional(),
  interleaved: InterleavedSchema.optional(),
  status: nonEmptyString.optional(),
  lifecycle: z.union([nonEmptyString, z.record(z.string(), z.unknown())]).optional(),
  license: nonEmptyString.optional(),
  links: z.array(z.record(z.string(), z.unknown())).optional(),
  weights: z.array(z.record(z.string(), z.unknown())).optional(),
  benchmarks: z.array(z.record(z.string(), z.unknown())).optional(),
})

const ProviderSchema = z.object({
  id: nonEmptyString,
  env: z.array(nonEmptyString).min(1),
  npm: nonEmptyString,
  api: nonEmptyString.optional(),
  name: nonEmptyString,
  doc: nonEmptyString,
  models: z.record(z.string(), ModelSchema),
})

const CatalogSchema = z.record(z.string(), ProviderSchema).superRefine((providers, context) => {
  for (const [providerKey, provider] of Object.entries(providers)) {
    if (providerKey !== provider.id) {
      context.addIssue({
        code: "custom",
        path: [providerKey, "id"],
        message: "Provider map key must match provider id",
      })
    }
    for (const [modelKey, model] of Object.entries(provider.models)) {
      if (modelKey !== model.id) {
        context.addIssue({
          code: "custom",
          path: [providerKey, "models", modelKey, "id"],
          message: "Model map key must match model id",
        })
      }
    }
  }
})

const SnapshotEnvelopeSchema = z.object({
  version: z.literal(CATALOG_SNAPSHOT_VERSION),
  source: nonEmptyString,
  fetchedAt: sourceTimestamp,
  catalog: CatalogSchema,
})

export type ReasoningOption = z.infer<typeof ReasoningOptionSchema>
export type CostTier = z.infer<typeof CostTierSchema>
export type CatalogCost = z.infer<typeof CostSchema>
export type CatalogLimit = z.infer<typeof LimitSchema>
export type CatalogModalities = z.infer<typeof ModalitiesSchema>
export type CatalogModel = z.infer<typeof ModelSchema>
export type CatalogProvider = z.infer<typeof ProviderSchema>
export type ModelsDevCatalog = z.infer<typeof CatalogSchema>
export type CatalogSnapshot = z.infer<typeof SnapshotEnvelopeSchema>

// These aliases make the storage boundary usable without coupling consumers to
// the upstream provider naming convention.
export type ModelsDevModel = CatalogModel
export type ModelsDevProvider = CatalogProvider
export type ModelsDevSnapshot = CatalogSnapshot

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

export function parseModelsDevCatalog(input: unknown): ModelsDevCatalog {
  return freeze(CatalogSchema.parse(input))
}

export function createCatalogSnapshot(
  input: unknown,
  options: { source?: string; fetchedAt?: number | string } = {},
): CatalogSnapshot {
  return freeze(
    SnapshotEnvelopeSchema.parse({
      version: CATALOG_SNAPSHOT_VERSION,
      source: options.source ?? MODELS_DEV_CATALOG_URL,
      fetchedAt: options.fetchedAt ?? Date.now(),
      catalog: parseModelsDevCatalog(input),
    }),
  )
}

export function parseCatalogSnapshot(input: unknown): CatalogSnapshot {
  return freeze(SnapshotEnvelopeSchema.parse(input))
}

export function readCatalogSnapshot(filePath: string): CatalogSnapshot | null {
  try {
    return parseCatalogSnapshot(JSON.parse(fs.readFileSync(filePath, "utf8")))
  } catch {
    return null
  }
}

export function writeCatalogSnapshotAtomic(
  filePath: string,
  snapshot: CatalogSnapshot,
): void {
  const validated = parseCatalogSnapshot(snapshot)
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  let descriptor: number | undefined
  try {
    fs.mkdirSync(directory, { recursive: true })
    descriptor = fs.openSync(temporaryPath, "wx", 0o600)
    fs.writeFileSync(descriptor, JSON.stringify(validated), "utf8")
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try {
      fs.unlinkSync(temporaryPath)
    } catch {
      // The temporary file was renamed or was never created.
    }
  }
}

export interface CatalogSnapshotStoreOptions {
  cachePath?: string
  sourceUrl?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export class CatalogSnapshotStore {
  readonly cachePath: string
  readonly sourceUrl: string
  readonly timeoutMs: number

  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private currentSnapshot: CatalogSnapshot | null = null
  private refreshInFlight: Promise<CatalogSnapshot | null> | null = null

  constructor(options: CatalogSnapshotStoreOptions = {}) {
    this.cachePath = options.cachePath ?? DEFAULT_CATALOG_SNAPSHOT_PATH
    this.sourceUrl = options.sourceUrl ?? MODELS_DEV_CATALOG_URL
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  get snapshot(): CatalogSnapshot | null {
    return this.currentSnapshot
  }

  loadCache(): CatalogSnapshot | null {
    const snapshot = readCatalogSnapshot(this.cachePath)
    if (snapshot) this.currentSnapshot = snapshot
    return this.currentSnapshot
  }

  refresh(): Promise<CatalogSnapshot | null> {
    if (this.refreshInFlight) return this.refreshInFlight

    const refresh = this.fetchAndPublish()
    const inFlight = refresh.finally(() => {
      if (this.refreshInFlight === inFlight) this.refreshInFlight = null
    })
    this.refreshInFlight = inFlight
    return inFlight
  }

  private async fetchAndPublish(): Promise<CatalogSnapshot | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.sourceUrl, { signal: controller.signal })
      if (!response.ok) return this.currentSnapshot
      const input: unknown = await response.json()
      const snapshot = createCatalogSnapshot(input, {
        source: this.sourceUrl,
        fetchedAt: this.now(),
      })
      writeCatalogSnapshotAtomic(this.cachePath, snapshot)
      this.currentSnapshot = snapshot
      return snapshot
    } catch {
      return this.currentSnapshot
    } finally {
      clearTimeout(timeout)
    }
  }
}
