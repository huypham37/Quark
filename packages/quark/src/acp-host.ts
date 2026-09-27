// `quark acp` — host process for the ACP agent.
//
// Owns config/profile resolution and stdio; delegates the protocol to
// @quark/acp. stdout carries only NDJSON protocol data — every diagnostic goes
// to stderr.

import { parseArgs } from "util"
import { createRunner, defaultSessionStore } from "@quark/runner"
import { CatalogRegistry } from "@quark/runner/provider/catalog-registry"
import { DEFAULT_CATALOG_SNAPSHOT_PATH, readCatalogSnapshot } from "@quark/runner/provider/catalog-snapshot"
import { ActiveProviderSet, type CatalogModelPair } from "@quark/runner/provider/active-providers"
import { DefaultCredentialResolver } from "@quark/runner/provider/credentials"
import { createDefaultCredentialStore } from "@quark/runner/provider/credential-store"
import { loadOAuthTokenFile } from "@quark/runner/provider/oauth-token-files"
import { createRuntimeProviderRegistry } from "@quark/runner/provider/resolver"
import { runAcpStdio, type ModelOption } from "@quark/acp"
import { materializeAgent, resolveAgent } from "./agent/agent"
import { loadConfig } from "./config/config"
import { loadAmbientInstructions } from "./ambient"

/**
 * Whether the model spec (e.g. "openai/gpt-5.6-luna") accepts image input,
 * from the local models.dev catalog snapshot. `undefined` when unknown —
 * the catalog is missing, stale, or the model is not listed — so images pass
 * through and the provider surfaces its own error instead of us guessing.
 */
function modelAcceptsImages(modelSpec: string | undefined): boolean | undefined {
  if (!modelSpec) return undefined
  const snapshot = readCatalogSnapshot(DEFAULT_CATALOG_SNAPSHOT_PATH)
  if (!snapshot) return undefined
  const [providerId, ...rest] = modelSpec.split("/")
  const modelId = rest.join("/")
  if (!providerId || !modelId) return undefined
  const model = new CatalogRegistry(snapshot).getModel(providerId, modelId)
  if (!model) return undefined
  return model.modalities.input.includes("image")
}

/**
 * Build the list of available models for the client model picker.
 *
 * Uses `ActiveProviderSet` to filter to providers the user actually has
 * credentials for (API keys in env or credential store), and ensures the
 * agent's default model is always included.
 */
async function buildAvailableModels(defaultModel?: string): Promise<ModelOption[]> {
  const snapshot = readCatalogSnapshot(DEFAULT_CATALOG_SNAPSHOT_PATH)
  if (!snapshot) return []
  const catalog = new CatalogRegistry(snapshot)

  let activePairs: readonly CatalogModelPair[] = []
  try {
    const credentialStore = await createDefaultCredentialStore()
    const resolver = new DefaultCredentialResolver(credentialStore, undefined, process.env, loadOAuthTokenFile)
    const providers = createRuntimeProviderRegistry()
    const activeProviders = new ActiveProviderSet(providers, resolver)
    await activeProviders.refresh()
    activePairs = activeProviders.listCatalogModelPairs(catalog)
  } catch {
    // If active providers resolution fails, proceed with default model only
  }

  const models: ModelOption[] = []
  const seen = new Set<string>()

  for (const [, catalogProviderId, model] of activePairs) {
    if (!model.tool_call) continue
    const id = `${catalogProviderId}/${model.id}`
    if (seen.has(id)) continue
    seen.add(id)
    const provider = catalog.getProvider(catalogProviderId)
    models.push({
      id,
      name: model.name,
      providerId: catalogProviderId,
      providerName: provider?.name ?? catalogProviderId,
      description: model.description?.replace(/\s+/g, " ").trim().slice(0, 160),
    })
  }

  // Ensure the agent's default model is always present in the options
  if (defaultModel && !seen.has(defaultModel)) {
    const [pId, ...rest] = defaultModel.split("/")
    const mId = rest.join("/")
    const model = pId && mId ? catalog.getModel(pId, mId) : null
    const provider = pId ? catalog.getProvider(pId) : null
    models.unshift({
      id: defaultModel,
      name: model?.name ?? defaultModel,
      providerId: pId,
      providerName: provider?.name ?? pId,
      description: model?.description?.replace(/\s+/g, " ").trim().slice(0, 160),
    })
  }

  return models
}

/**
 * Run the ACP stdio server until the client closes stdin. Returns a process
 * exit code; the caller exits with it.
 */
export async function runAcpCommand(argv: string[]): Promise<number> {
  if (argv.some((arg) => arg === "--profile" || arg.startsWith("--profile=") || arg === "-p")) {
    throw new Error("ACP --profile/-p is removed; use --agent/-a")
  }
  let agentId: string | undefined
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
      },
      allowPositionals: true,
      strict: false,
    })
    agentId = values.agent as string | undefined
  } catch {
    // Unknown flags are ignored: the ACP client, not the user, owns this argv.
  }

  const agent = await materializeAgent(resolveAgent(agentId))
  const config = loadConfig()
  const models = await buildAvailableModels(agent.model)

  await runAcpStdio({
    // Session-scoped runner: @quark/acp calls this once per ACP session, lazily
    // on first prompt, handing back the connection's shared store and any MCP
    // tools discovered from the client's stdio servers. Merging them here (the
    // app owns agent resolution) is what makes those tools callable.
    createRunner: (_cwd, store, mcpTools) =>
      createRunner({
        agent: mcpTools.length > 0 ? { ...agent, tools: [...agent.tools, ...mcpTools] } : agent,
        store,
        ambientInstructions: loadAmbientInstructions,
        policies: {
          maxSteps: config.maxSteps,
          branching: config.branching,
          smallModel: config.models.small,
        },
        resolve: { providers: config.providers },
      }),
    // Same persistent store the CLI/TUI use, so ACP sessions survive a restart
    // and are the ones `session/list` reports.
    store: defaultSessionStore,
    // Option B: always advertise image prompts (the plumbing maps them to
    // RunnerPromptInput.images), and reject up front with a clear error only
    // when the catalog says the model cannot see.
    images: true,
    imageSupport: modelAcceptsImages(agent.model),
    // Model picker: advertise all tool-calling models from the catalog so the
    // client (Zed) renders a model selector in the Agent Panel.
    models,
    defaultModel: agent.model,
    log: (message) => process.stderr.write(`[quark acp] ${message}\n`),
  })
  return 0
}
