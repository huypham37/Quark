import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { TypedBus } from "../../packages/runner/src/session/events"
import { CatalogModelRuntime } from "../../packages/quark/src/tui/catalog-model-runtime"
import { CatalogSnapshotStore, createCatalogSnapshot, writeCatalogSnapshotAtomic } from "../../packages/runner/src/provider/catalog-snapshot"
import { bindCatalogContext } from "../../packages/quark/src/tui/catalog-context"
import { createAppState } from "../../packages/quark/src/tui/state"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("deferred cache arrival updates the same selected model's context limit and cleans up its listener", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quark-catalog-context-"))
  let dispose = () => {}
  try {
    const cachePath = join(dir, "catalog.json")
    const model = (id: string, context: number) => ({
      id, name: id, description: id, attachment: false, reasoning: false, tool_call: true,
      release_date: "2025-01-01", last_updated: "2025-01-01",
      modalities: { input: ["text"], output: ["text"] }, open_weights: false,
      limit: { context, output: 4_000 },
    })
    writeCatalogSnapshotAtomic(cachePath, createCatalogSnapshot({
      openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"], doc: "https://example.com",
        models: { first: model("first", 100_000), second: model("second", 200_000) } },
    }))
    const bus = new TypedBus()
    const runtime = await CatalogModelRuntime.create(bus, {
      snapshotStore: new CatalogSnapshotStore({ cachePath, fetch: async () => { throw new Error("offline") } }),
      credentialStore: { get: async () => null, set: async () => {}, delete: async () => {}, status: async () => "missing" },
    })
    const state = createRoot((cleanup) => {
      dispose = cleanup
      const state = createAppState({ sessionId: null, modelName: "openai/first", skillCount: 0 })
      bindCatalogContext(state, bus, (spec) => runtime.catalog.getModel("openai", spec.split("/")[1]!))
      return state
    })
    expect(state.store.status.tokenLimit).toBe(0)
    runtime.loadCachedCatalog()
    expect(state.store.status.modelName).toBe("openai/first")
    expect(state.store.status.tokenLimit).toBe(100_000)
    state.setStore("status", "modelName", "openai/second")
    expect(state.store.status.tokenLimit).toBe(200_000)
    dispose()
    state.setStore("status", "tokenLimit", 123)
    bus.emit("catalog-refreshed", {})
    expect(state.store.status.tokenLimit).toBe(123)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
