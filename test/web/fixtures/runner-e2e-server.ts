// HTTP/process fixture: production backend + create route, offline model stream.
import { WebBackend } from "../../../web/backend"
import { createRunner } from "../../../packages/runner/src/runner"
import { setSessionStorageRoot } from "../../../packages/runner/src/storage/session-path"
import { CatalogRegistry } from "../../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../../packages/runner/src/provider/catalog-snapshot"

setSessionStorageRoot(process.env.QUARK_E2E_SESSION_ROOT!)
const backend = await WebBackend.create()
const runners = (backend as any).runners as Map<string, ReturnType<typeof createRunner>>
const catalog = new CatalogRegistry(createCatalogSnapshot({
  ollama: {
    id: "ollama", name: "Ollama", npm: "@ollama/ai", env: ["OLLAMA_API_KEY"], doc: "https://example.com",
    models: { "e2e-test": {
      id: "e2e-test", name: "e2e-test", description: "offline", attachment: false,
      reasoning: false, tool_call: true, release_date: "2025-01-01", last_updated: "2025-01-01",
      modalities: { input: ["text"], output: ["text"] }, open_weights: false,
      limit: { context: 100000, output: 4000 },
    } },
  },
}, { fetchedAt: 1 }))

const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const response = await backend.fetch(request)
    // Preserve the real creation path and its disk store, but replace provider
    // streaming so this proof never needs credentials or external network.
    if (request.method === "POST" && new URL(request.url).pathname === "/api/runners" && response.status === 201) {
      const { runnerId } = await response.clone().json()
      const created = runners.get(runnerId)!
      runners.set(runnerId, createRunner({
        agent: created.agent,
        store: created.store,
        resolve: { providers: {}, catalog },
        stream: () => ({ fullStream: (async function* () {
          yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
          yield { type: "finish" }
        })() }),
      }))
    }
    return response
  },
})
console.log(JSON.stringify({ port: server.port }))
