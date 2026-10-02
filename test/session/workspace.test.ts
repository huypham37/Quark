// A turn's `targetWorkspace` is not session metadata: it must reach the system
// prompt, the ambient builder, and every tool's context, without a process-wide
// chdir. On resume the session's stored directory wins, so a conversation never
// silently moves.

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { defineAgent } from "../../packages/runner/src/agent"
import { createRunner } from "../../packages/runner/src/runner"
import { resolveToolSet } from "../../packages/runner/src/tool/ai-adapter"
import { readTool } from "../../packages/runner/src/tool/read"
import { defineTool } from "../../packages/runner/src/tool/tool"
import { TypedBus } from "../../packages/runner/src/session/events"
import { CatalogRegistry } from "../../packages/runner/src/provider/catalog-registry"
import { createCatalogSnapshot } from "../../packages/runner/src/provider/catalog-snapshot"
import type { StreamFn } from "../../packages/runner/src/session/processor"

const MODEL = "ollama/test-model"
const text = [{ type: "text" as const, text: "hi" }]

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "quark-workspace-"))
}

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

function portableAgent() {
  return defineAgent({ id: "portable", instructions: "Portable instructions", tools: [], model: MODEL })
}

describe("targetWorkspace reaches the run, not just the session", () => {
  test("system prompt and session directory follow the workspace", async () => {
    const ws = workspace()
    try {
      const cap = captureStream()
      const runner = createRunner({ agent: portableAgent(), stream: cap.stream })

      const { sessionId } = await runner.prompt({ parts: text, targetWorkspace: ws, catalog: catalog() })

      expect(cap.captured[0]).toContain(`Working directory: ${ws}`)
      expect(cap.captured[0]).not.toContain(process.cwd())
      expect(runner.store.get(sessionId)!.directory).toBe(ws)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("the ambient builder is handed the workspace root", async () => {
    const ws = workspace()
    try {
      const cap = captureStream()
      const runner = createRunner({
        agent: portableAgent(),
        stream: cap.stream,
        ambientInstructions: (workspace) => `WS_BUILDER:${workspace}`,
      })

      await runner.prompt({ parts: text, targetWorkspace: ws, catalog: catalog() })

      expect(cap.captured[0]).toContain(`WS_BUILDER:${ws}`)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test("resume keeps the stored workspace even when another is named", async () => {
    const a = workspace()
    const b = workspace()
    try {
      const cap = captureStream()
      const runner = createRunner({ agent: portableAgent(), stream: cap.stream })

      const first = await runner.prompt({ parts: text, targetWorkspace: a, catalog: catalog() })
      await runner.prompt({ sessionId: first.sessionId, parts: text, targetWorkspace: b, catalog: catalog() })

      expect(cap.captured[1]).toContain(`Working directory: ${a}`)
      expect(cap.captured[1]).not.toContain(b)
      expect(runner.store.get(first.sessionId)!.directory).toBe(a)
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  })

  test("tools get the workspace and read resolves relative paths against it", async () => {
    const ws = workspace()
    try {
      writeFileSync(join(ws, "notes.txt"), "WORKSPACE_FILE")

      const seen: Array<string | undefined> = []
      const capture = defineTool({
        id: "capture",
        description: "record the tool context workspace",
        parameters: z.object({}),
        async execute(_args, ctx) {
          seen.push(ctx.workspace)
          return { title: "capture", output: "", metadata: {} }
        },
      })

      const tools = resolveToolSet(
        { tools: [capture, readTool] },
        "s",
        "m",
        new AbortController().signal,
        new TypedBus(),
        undefined,
        { undo: false, workspace: ws },
      )

      await (tools.capture as any).execute({}, { toolCallId: "t1", messages: [] })
      expect(seen).toEqual([ws])

      const result = await (tools.read as any).execute({ path: "notes.txt" }, { toolCallId: "t2", messages: [] })
      expect(result.output).toContain("WORKSPACE_FILE")
      expect(result.metadata.path).toBe(join(ws, "notes.txt"))
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })
})
