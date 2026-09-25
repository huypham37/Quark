// Portable AgentDefinition tests — defineAgent() on the real runner path.
//
// Everything runs through createRunner → prompt → loop → processStream, with
// the model call faked via the `stream` seam (no network). This exercises the
// actual wiring, not just the helpers:
//
//   1. persona + instructions reach the system prompt the model receives
//   2. two runners may declare tools with the same ID but different
//      implementations; each run uses its own, and neither is registered in
//      the global tool registry
//   3. concrete skill definitions feed both the system prompt and the
//      synthesized `skill` tool

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { defineAgent } from "../../packages/runner/src/agent"
import { createRunner } from "../../packages/runner/src/runner"
import { createSession, setSessionTitle } from "../../packages/runner/src/session/session"
import { ensureStorageRoot } from "../../packages/runner/src/storage/session-jsonl"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import { defineTool } from "../../packages/runner/src/tool/tool"
import { get as getRegisteredTool } from "../../packages/runner/src/tool/registry"
import { bus as legacyBus } from "../../packages/runner/src/session/events"
import type { StreamFn } from "../../packages/runner/src/session/processor"

const MODEL = "ollama/test-model"

let storageRoot: string

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "quark-test-agent-definition-"))
  setSessionStorageRoot(storageRoot)
  ensureStorageRoot()
})

afterAll(() => {
  setSessionStorageRoot(undefined)
  rmSync(storageRoot, { recursive: true, force: true })
})

afterEach(() => {
  legacyBus.removeAllListeners()
  delete process.env.QUARK_SESSION_ID
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

/** Stream seam that captures what the loop actually handed the model. */
function captureStream() {
  const captured: { system: string[]; tools: Record<string, any> }[] = []
  const stream: StreamFn = (options) => {
    // processStream folds the system prompt into `messages` as role:"system".
    const system = (options.messages as any[])
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    captured.push({ system, tools: options.tools })
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

describe("AgentDefinition — persona + instructions on the runner path", () => {
  test("each runner's system prompt carries only its own persona/instructions", async () => {
    const a = captureStream()
    const b = captureStream()

    const runnerA = createRunner({
      agent: defineAgent({ id: "agent-a", persona: "Persona Alpha", instructions: "Instruction Alpha", tools: [], model: MODEL }),
      stream: a.stream,
    })
    const runnerB = createRunner({
      agent: defineAgent({ id: "agent-b", persona: "Persona Beta", instructions: "Instruction Beta", tools: [], model: MODEL }),
      stream: b.stream,
    })

    await Promise.all([
      runnerA.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
      runnerB.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
    ])

    const systemA = a.captured[0]!.system.join("\n")
    const systemB = b.captured[0]!.system.join("\n")

    expect(systemA).toContain("Persona Alpha")
    expect(systemA).toContain("Instruction Alpha")
    expect(systemB).toContain("Persona Beta")
    expect(systemB).toContain("Instruction Beta")

    expect(systemA).not.toContain("Persona Beta")
    expect(systemB).not.toContain("Persona Alpha")
  })
})

describe("AgentDefinition — per-call agent cannot override the bound agent", () => {
  test("a stray per-call agent is ignored; the runner's own agent runs", async () => {
    const cap = captureStream()
    const runner = createRunner({
      agent: defineAgent({ id: "bound", persona: "Persona Bound", instructions: "Instruction Bound", tools: [], model: MODEL }),
      stream: cap.stream,
    })

    await runner.prompt({
      sessionId: titledSession(),
      parts: text,
      catalog: catalog(),
      // Removed from the public type, but an untyped/legacy caller may still
      // send it: it must not switch agent mode mid-run.
      agent: { id: "intruder", name: "Intruder", prompt: "Persona Intruder", tools: [], skills: [] },
    } as any)

    const system = cap.captured[0]!.system.join("\n")
    expect(system).toContain("Persona Bound")
    expect(system).toContain("Instruction Bound")
    expect(system).not.toContain("Persona Intruder")
  })
})

describe("AgentDefinition — same-ID tool isolation", () => {
  function sharedTool(mark: string) {
    return defineTool({
      id: "shared",
      description: "same id, different implementation",
      parameters: z.object({ x: z.number() }),
      async execute(args) {
        return { title: "shared", output: `${mark}:${args.x}`, metadata: {} }
      },
    })
  }

  test("two runners with the same tool ID each run their own implementation", async () => {
    const a = captureStream()
    const b = captureStream()

    const runnerA = createRunner({
      agent: defineAgent({ id: "agent-a", instructions: "A", tools: [sharedTool("A")], model: MODEL }),
      stream: a.stream,
    })
    const runnerB = createRunner({
      agent: defineAgent({ id: "agent-b", instructions: "B", tools: [sharedTool("B")], model: MODEL }),
      stream: b.stream,
    })

    await Promise.all([
      runnerA.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
      runnerB.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() }),
    ])

    const call = { toolCallId: "call-1", messages: [], abortSignal: new AbortController().signal }
    const resultA = await a.captured[0]!.tools["shared"].execute({ x: 1 }, call)
    const resultB = await b.captured[0]!.tools["shared"].execute({ x: 1 }, call)

    expect(resultA.output).toBe("A:1")
    expect(resultB.output).toBe("B:1")

    // Instance-scoped: the concrete tool never entered the global registry.
    expect(getRegisteredTool("shared")).toBeUndefined()
  })
})

describe("AgentDefinition — concrete skills", () => {
  test("skill metadata reaches the system prompt and the skill tool loads its content", async () => {
    const cap = captureStream()

    const runner = createRunner({
      agent: defineAgent({
        id: "skilled",
        instructions: "Skilled agent",
        tools: [],
        skills: [{ name: "focus", description: "Focus mode", content: "Do the focused thing." }],
        model: MODEL,
      }),
      stream: cap.stream,
    })

    await runner.prompt({ sessionId: titledSession(), parts: text, catalog: catalog() })

    expect(cap.captured[0]!.system.join("\n")).toContain("**focus**: Focus mode")

    const skillTool = cap.captured[0]!.tools["skill"]
    const result = await skillTool.execute(
      { name: "focus" },
      { toolCallId: "call-2", messages: [], abortSignal: new AbortController().signal },
    )
    expect(result.output).toContain("Do the focused thing.")
  })
})
