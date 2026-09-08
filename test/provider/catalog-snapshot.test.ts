import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  CatalogSnapshotStore,
  createCatalogSnapshot,
  parseCatalogSnapshot,
  parseModelsDevCatalog,
  writeCatalogSnapshotAtomic,
} from "../../src/provider/catalog-snapshot"

function validCatalog() {
  return {
    acme: {
      id: "acme",
      name: "Acme AI",
      npm: "@acme/ai",
      env: ["ACME_API_KEY"],
      doc: "https://acme.example/docs",
      unexpected_future_field: { preserved_by_input: true },
      models: {
        "acme/reasoner": {
          id: "acme/reasoner",
          name: "Acme Reasoner",
          description: "A reasoning model",
          attachment: true,
          reasoning: true,
          reasoning_options: [
            { type: "effort", values: ["low", "high", null] },
            { type: "budget_tokens", min: 1024, max: 8192 },
          ],
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-06-01",
          structured_output: true,
          modalities: { input: ["text", "image"], output: ["text"] },
          open_weights: false,
          limit: { context: 200_000, input: 180_000, output: 16_000 },
          cost: {
            input: 3,
            output: 15,
            reasoning: 15,
            tiers: [
              { tier: { type: "context", size: 200_000 }, input: 4, output: 20 },
            ],
          },
          interleaved: { field: "reasoning_content" },
          status: "beta",
          lifecycle: { state: "preview" },
          future_field: "ignored safely",
        },
      },
    },
  }
}

let temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true })
  temporaryDirectories = []
})

function temporaryPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quark-catalog-"))
  temporaryDirectories.push(directory)
  return path.join(directory, "snapshot.json")
}

describe("models.dev catalog snapshots", () => {
  test("validates required catalog data while tolerating unknown upstream fields", () => {
    const catalog = parseModelsDevCatalog(validCatalog())
    expect(catalog.acme.models["acme/reasoner"]?.cost?.tiers?.[0]?.tier.size).toBe(200_000)
    expect((catalog.acme.models["acme/reasoner"] as Record<string, unknown>).future_field).toBeUndefined()
  })

  test("rejects malformed required structures and schema drift", () => {
    expect(() => parseModelsDevCatalog({ ...validCatalog(), acme: { ...validCatalog().acme, models: [] } })).toThrow()
    expect(() => parseModelsDevCatalog({
      ...validCatalog(),
      acme: {
        ...validCatalog().acme,
        models: {
          "acme/reasoner": {
            ...validCatalog().acme.models["acme/reasoner"],
            limit: { context: -1, output: 1 },
          },
        },
      },
    })).toThrow()
    expect(() => parseModelsDevCatalog({
      ...validCatalog(),
      acme: {
        ...validCatalog().acme,
        models: {
          "different-id": validCatalog().acme.models["acme/reasoner"],
        },
      },
    })).toThrow()
  })

  test("round-trips a versioned envelope and rejects corrupt cache data", () => {
    const snapshot = createCatalogSnapshot(validCatalog(), { fetchedAt: 123 })
    expect(parseCatalogSnapshot(snapshot)).toEqual(snapshot)
    expect(() => parseCatalogSnapshot({ ...snapshot, version: 999 })).toThrow()

    const filePath = temporaryPath()
    fs.writeFileSync(filePath, "not json")
    const store = new CatalogSnapshotStore({ cachePath: filePath })
    expect(store.loadCache()).toBeNull()
  })

  test("writes snapshots atomically and retains the last-known-good state on write failure", async () => {
    const filePath = temporaryPath()
    const first = createCatalogSnapshot(validCatalog(), { fetchedAt: 1 })
    writeCatalogSnapshotAtomic(filePath, first)

    let calls = 0
    const secondCatalog = validCatalog()
    secondCatalog.acme.models["acme/reasoner"]!.name = "Updated"
    const store = new CatalogSnapshotStore({
      cachePath: filePath,
      fetch: async () => {
        calls++
        return new Response(JSON.stringify(secondCatalog), { status: 200 })
      },
      now: () => 2,
    })
    expect(store.loadCache()).toEqual(first)

    fs.rmSync(filePath)
    fs.mkdirSync(filePath)
    expect(await store.refresh()).toEqual(first)
    expect(calls).toBe(1)
    expect(store.snapshot).toEqual(first)
  })

  test("uses cache offline and serializes concurrent refresh publication", async () => {
    const filePath = temporaryPath()
    const first = createCatalogSnapshot(validCatalog(), { fetchedAt: 1 })
    writeCatalogSnapshotAtomic(filePath, first)
    let calls = 0
    let releaseFetch!: () => void
    const fetchDone = new Promise<void>((resolve) => { releaseFetch = resolve })
    const store = new CatalogSnapshotStore({
      cachePath: filePath,
      fetch: async () => {
        calls++
        await fetchDone
        return new Response(JSON.stringify(validCatalog()), { status: 200 })
      },
      now: () => 2,
    })
    expect(store.loadCache()).toEqual(first)

    const refreshOne = store.refresh()
    const refreshTwo = store.refresh()
    expect(refreshOne).toBe(refreshTwo)
    expect(calls).toBe(1)
    releaseFetch()
    expect(await refreshOne).not.toBeNull()
    expect(store.snapshot?.fetchedAt).toBe(2)

    const offline = new CatalogSnapshotStore({
      cachePath: filePath,
      fetch: async () => { throw new Error("offline") },
    })
    expect(offline.loadCache()).not.toBeNull()
    expect(await offline.refresh()).not.toBeNull()
  })
})
