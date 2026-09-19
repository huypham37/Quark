// Instance runner isolation tests (Step 2 — package split)
//
// Two createRunner() instances bound to distinct AgentDefinitions must not share:
//   1. event listeners  — an event emitted by one runner stays on its bus
//   2. active/cancel state — cancelling one run must not touch the other
//
// No network/LLM is involved: execution is injected, so we exercise the
// runner's bus + cancellation plumbing around the explicit runtime shape.

import { describe, expect, test } from "bun:test"
import { createRunner } from "../../packages/runner/src/runner"
import { defineAgent, type AgentDefinition } from "../../packages/runner/src/agent"
import { bus as legacyBus } from "../../packages/runner/src/session/events"
import { isActive as legacyIsActive } from "../../packages/runner/src/session/prompt"
import type { RunnerExecute } from "../../packages/runner/src/runner"

const agentA: AgentDefinition = defineAgent({ id: "agent-a", name: "Agent A", instructions: "A", tools: [] })
const agentB: AgentDefinition = defineAgent({ id: "agent-b", name: "Agent B", instructions: "B", tools: [] })

const text = [{ type: "text" as const, text: "hi" }]

describe("createRunner — isolation", () => {
  test("binds its own agent and owns a bus distinct from the legacy singleton", () => {
    const a = createRunner({ agent: agentA })
    const b = createRunner({ agent: agentB })

    expect(a.agent).toBe(agentA)
    expect(b.agent).toBe(agentB)
    expect(a.bus).not.toBe(b.bus)
    expect(a.bus).not.toBe(legacyBus)
    expect(a.run).toBe(a.prompt)
  })

  test("event streams are isolated between two runners", async () => {
    const seenA: string[] = []
    const seenB: string[] = []

    const a = createRunner({
      agent: agentA,
      execute: async (_input, ctx) => {
        ctx.bus.emit("text-delta", {
          sessionId: "s-a", messageId: "m", partId: "p", delta: "from-a", text: "from-a",
        })
        return { sessionId: "s-a" }
      },
    })
    const b = createRunner({
      agent: agentB,
      execute: async (_input, ctx) => {
        ctx.bus.emit("text-delta", {
          sessionId: "s-b", messageId: "m", partId: "p", delta: "from-b", text: "from-b",
        })
        return { sessionId: "s-b" }
      },
    })

    a.bus.on("text-delta", ({ delta }) => seenA.push(delta))
    b.bus.on("text-delta", ({ delta }) => seenB.push(delta))

    await a.prompt({ sessionId: "s-a", parts: text })
    await b.prompt({ sessionId: "s-b", parts: text })

    expect(seenA).toEqual(["from-a"])
    expect(seenB).toEqual(["from-b"])
  })

  test("active/cancel state is isolated between two runners", async () => {
    let abortedA = false
    let abortedB = false

    const hanging = (sessionId: string, mark: (v: boolean) => void): RunnerExecute =>
      (_input, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            mark(true)
            resolve({ sessionId })
          })
        })

    const a = createRunner({ agent: agentA, execute: hanging("s-a", (v) => (abortedA = v)) })
    const b = createRunner({ agent: agentB, execute: hanging("s-b", (v) => (abortedB = v)) })

    const runA = a.prompt({ sessionId: "s-a", parts: text })
    const runB = b.prompt({ sessionId: "s-b", parts: text })

    expect(a.isActive("s-a")).toBe(true)
    expect(a.isActive("s-b")).toBe(false)
    expect(b.isActive("s-b")).toBe(true)
    expect(b.isActive("s-a")).toBe(false)
    expect(legacyIsActive("s-a")).toBe(false)

    // Cancelling A must not touch B.
    a.cancel("s-a")
    expect(abortedA).toBe(true)
    expect(abortedB).toBe(false)
    expect(a.isActive("s-a")).toBe(false)
    expect(b.isActive("s-b")).toBe(true)

    b.cancel("s-b")
    await Promise.all([runA, runB])

    expect(abortedB).toBe(true)
    expect(a.isActive("s-a")).toBe(false)
    expect(b.isActive("s-b")).toBe(false)
  })

  test("a run cleans up its session from the active map when it finishes", async () => {
    const a = createRunner({
      agent: agentA,
      execute: async () => ({ sessionId: "s-done" }),
    })

    await a.prompt({ sessionId: "s-done", parts: text })
    expect(a.isActive("s-done")).toBe(false)
  })

  test("a second prompt for an already-active session is rejected and leaves the first cancellable", async () => {
    let aborted = false
    const runner = createRunner({
      agent: agentA,
      execute: (_input, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true
            resolve({ sessionId: "s-dup" })
          })
        }),
    })

    const first = runner.prompt({ sessionId: "s-dup", parts: text })
    expect(runner.isActive("s-dup")).toBe(true)

    await expect(runner.prompt({ sessionId: "s-dup", parts: text })).rejects.toThrow(/already active/)
    // The rejected call must not have replaced the first run's controller.
    expect(runner.isActive("s-dup")).toBe(true)
    runner.cancel("s-dup")
    expect(aborted).toBe(true)

    await first
    expect(runner.isActive("s-dup")).toBe(false)
  })

  test("a session ID can run again once the previous run has settled", async () => {
    const runner = createRunner({ agent: agentA, execute: async () => ({ sessionId: "s-seq" }) })

    await runner.prompt({ sessionId: "s-seq", parts: text })
    await runner.prompt({ sessionId: "s-seq", parts: text })

    expect(runner.isActive("s-seq")).toBe(false)
  })

  test("concurrent prompts without a supplied session ID stay allowed", async () => {
    let n = 0
    const runner = createRunner({ agent: agentA, execute: async () => ({ sessionId: `gen-${++n}` }) })

    const results = await Promise.all([
      runner.prompt({ parts: text }),
      runner.prompt({ parts: text }),
    ])

    expect(results.map((r) => r.sessionId).sort()).toEqual(["gen-1", "gen-2"])
  })
})
