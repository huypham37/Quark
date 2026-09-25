// Ambient instruction loading is explicit for portable runner runs.
//
// A poisoned AGENTS.md is planted in both cwd (project) and QUARK_CONFIG_DIR
// (global). A portable AgentDefinition must pick up neither, and must include
// exactly what RunnerOptions.ambientInstructions supplies.

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineAgent } from "../../packages/runner/src/agent"
import { createRunner } from "../../packages/runner/src/runner"
import { buildSystem } from "../../packages/runner/src/session/system"
import { createSession, setSessionTitle } from "../../packages/runner/src/session/session"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import type { StreamFn } from "../../packages/runner/src/session/processor"

const MODEL = "ollama/test-model"
const PROJECT_POISON = "POISON_PROJECT_AGENTS"
const GLOBAL_POISON = "POISON_GLOBAL_AGENTS"

let poisonCwd: string
let poisonConfigDir: string
let storageRoot: string
const originalCwd = process.cwd()
const originalConfigDir = process.env.QUARK_CONFIG_DIR

beforeAll(() => {
  poisonCwd = mkdtempSync(join(tmpdir(), "quark-poison-cwd-"))
  writeFileSync(join(poisonCwd, "AGENTS.md"), `# poison\n\n${PROJECT_POISON}\n`)

  poisonConfigDir = mkdtempSync(join(tmpdir(), "quark-poison-config-"))
  writeFileSync(join(poisonConfigDir, "AGENTS.md"), `# poison\n\n${GLOBAL_POISON}\n`)

  process.chdir(poisonCwd)
  process.env.QUARK_CONFIG_DIR = poisonConfigDir

  storageRoot = mkdtempSync(join(tmpdir(), "quark-ambient-storage-"))
  setSessionStorageRoot(storageRoot)
  ensureStorageRoot()
})

afterAll(() => {
  process.chdir(originalCwd)
  if (originalConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = originalConfigDir
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
  rmSync(poisonCwd, { recursive: true, force: true })
  rmSync(poisonConfigDir, { recursive: true, force: true })
})

function catalog(): CatalogRegistry {
  return new CatalogRegistry(createCatalogSnapshot({
    ollama: {
      id: "ollama",
      name: "Ollama",
      npm: "@ollama/ai",
      env: ["OLLAMA_API_KEY"],
      doc: "https://ollama.example/docs",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          description: "offline test model",
          attachment: false,
          reasoning: false,
          tool_call: true,
          release_date: "2025-01-01",
          last_updated: "2025-01-01",
          modalities: { input: ["text"], output: ["text"] },
          open_weights: false,
          limit: { context: 100_000, output: 4_000 },
        },
      },
    },
  }, { fetchedAt: 1 }))
}

function captureStream() {
  const captured: string[] = []
  const stream: StreamFn = (options) => {
    captured.push(
      (options.messages as any[])
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n"),
    )
    return {
      fullStream: (async function* () {
        yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: "finish" }
      })(),
    }
  }
  return { captured, stream }
}

function titledSession(): string {
  const session = createSession()
  setSessionTitle(session.id, "test session")
  return session.id
}

const text = [{ type: "text" as const, text: "hi" }]

function portableAgent() {
  return defineAgent({ id: "portable", instructions: "Portable instructions", tools: [], model: MODEL })
}

describe("ambient instructions — buildSystem", () => {
  test("no ambient argument means the poisoned AGENTS.md files are never read", () => {
    const system = buildSystem(portableAgent()).join("\n")
    expect(system).not.toContain(PROJECT_POISON)
    expect(system).not.toContain(GLOBAL_POISON)
    expect(system).toContain("Portable instructions")
  })

  test("null disables implicit reads", () => {
    const system = buildSystem(portableAgent(), null).join("\n")
    expect(system).not.toContain(PROJECT_POISON)
    expect(system).not.toContain(GLOBAL_POISON)
    expect(system).toContain("Portable instructions")
  })

  test("explicit string / array / builder are included verbatim", () => {
    expect(buildSystem(portableAgent(), "AMBIENT_ONE").join("\n")).toContain("AMBIENT_ONE")
    expect(buildSystem(portableAgent(), ["AMBIENT_A", "AMBIENT_B"]).join("\n")).toContain("AMBIENT_B")
    expect(buildSystem(portableAgent(), () => "AMBIENT_FN").join("\n")).toContain("AMBIENT_FN")
  })
})

describe("createRunner + portable AgentDefinition ignores ambient AGENTS.md", () => {
  test("default run includes only the AgentDefinition", async () => {
    const cap = captureStream()
    const runner = createRunner({ agent: portableAgent(), stream: cap.stream })
    await runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })

    const system = cap.captured[0]!
    expect(system).toContain("Portable instructions")
    expect(system).not.toContain(PROJECT_POISON)
    expect(system).not.toContain(GLOBAL_POISON)
  })

  test("explicit RunnerOptions.ambientInstructions is included instead", async () => {
    const cap = captureStream()
    const runner = createRunner({
      agent: portableAgent(),
      stream: cap.stream,
      ambientInstructions: "HOST_SUPPLIED_CONTEXT",
    })
    await runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })

    const system = cap.captured[0]!
    expect(system).toContain("HOST_SUPPLIED_CONTEXT")
    expect(system).not.toContain(PROJECT_POISON)
    expect(system).not.toContain(GLOBAL_POISON)
  })

  test("injected builder is called and its output included", async () => {
    const cap = captureStream()
    const runner = createRunner({
      agent: portableAgent(),
      stream: cap.stream,
      ambientInstructions: () => ["BUILT_A", "BUILT_B"],
    })
    await runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })

    const system = cap.captured[0]!
    expect(system).toContain("BUILT_A")
    expect(system).toContain("BUILT_B")
  })
})
