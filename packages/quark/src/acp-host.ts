// `quark acp` — host process for the ACP agent.
//
// Owns config/profile resolution and stdio; delegates the protocol to
// @quark/acp. stdout carries only NDJSON protocol data — every diagnostic goes
// to stderr.

import { parseArgs } from "util"
import { createRunner, defaultSessionStore } from "@quark/runner"
import { CatalogRegistry } from "@quark/runner/provider/catalog-registry"
import { DEFAULT_CATALOG_SNAPSHOT_PATH, readCatalogSnapshot } from "@quark/runner/provider/catalog-snapshot"
import { runAcpStdio } from "@quark/acp"
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
 * Run the ACP stdio server until the client closes stdin. Returns a process
 * exit code; the caller exits with it.
 */
export async function runAcpCommand(argv: string[]): Promise<number> {
  let agentId: string | undefined
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
        profile: { type: "string", short: "p" }, // compatibility alias
      },
      allowPositionals: true,
      strict: false,
    })
    agentId = (values.agent ?? values.profile) as string | undefined
  } catch {
    // Unknown flags are ignored: the ACP client, not the user, owns this argv.
  }

  const agent = await materializeAgent(resolveAgent(agentId))
  const config = loadConfig()

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
    log: (message) => process.stderr.write(`[quark acp] ${message}\n`),
  })
  return 0
}
