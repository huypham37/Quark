// QUA-266 — `tool-running` must not be emitted until the permission hook
// (`tool.execute.before`) has resolved and the undo snapshot has succeeded.
//
// Pending = parsed but not yet authorized/prepared. Running = execution is
// about to begin. Emitting earlier renders a tool as running before it is
// authorized (and flashes "running" for tools that are denied).

import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { resolveToolSet } from "../../packages/runner/src/tool/ai-adapter"
import { defineTool } from "../../packages/runner/src/tool/tool"
import { TypedBus, type BusEventName } from "../../packages/runner/src/session/events"
import { createHookRegistry } from "../../packages/runner/src/plugin/registry"

const TOOL = "qua266-tool"
const POLICY = { undo: false } // no undo snapshot IO in these tests
const SIGNAL = new AbortController().signal

function watch(bus: TypedBus) {
  const seen: { name: BusEventName; data: any }[] = []
  for (const name of ["tool-start", "tool-input", "tool-running", "tool-end"] as BusEventName[]) {
    bus.on(name, (data) => seen.push({ name, data }))
  }
  return seen
}

function makeTool(lifecycle: string[]) {
  return defineTool({
    id: TOOL,
    description: "test tool",
    parameters: z.object({ x: z.number() }),
    async execute() {
      lifecycle.push("execute")
      return { title: "t", output: "ok", metadata: {} }
    },
  })
}

function build(bus: TypedBus, hooks = createHookRegistry(), lifecycle: string[] = []) {
  const tools = resolveToolSet({ tools: [makeTool(lifecycle)] }, "s-1", "m-1", SIGNAL, bus, hooks, POLICY)
  return { tools, run: () => (tools[TOOL] as any).execute({ x: 1 }, { toolCallId: "call-1", messages: [], abortSignal: SIGNAL }) }
}

describe("QUA-266: tool-running follows authorization + preparation", () => {
  test("no tool-running while tool.execute.before is in flight", async () => {
    const bus = new TypedBus()
    const seen = watch(bus)
    const lifecycle: string[] = []
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const hooks = createHookRegistry()
    hooks.register("tool.execute.before", async () => {
      entered.resolve()
      await gate.promise
    })

    const { run } = build(bus, hooks, lifecycle)
    const pending = run()
    await entered.promise

    // Hook is in flight: parsed, but not authorized/prepared → still pending.
    expect(seen.filter((e) => e.name === "tool-running")).toEqual([])
    expect(lifecycle).toEqual([])

    gate.resolve()
    await pending
    expect(seen.filter((e) => e.name === "tool-running").length).toBe(1)
    expect(lifecycle).toEqual(["execute"])
  })

  test("a denied tool never emits tool-running and never executes", async () => {
    const bus = new TypedBus()
    const seen = watch(bus)
    const lifecycle: string[] = []
    const hooks = createHookRegistry()
    hooks.register("tool.execute.before", async () => {
      throw new Error("permission denied")
    })

    const { run } = build(bus, hooks, lifecycle)
    await expect(run()).rejects.toThrow("permission denied")

    expect(seen.filter((e) => e.name === "tool-running")).toEqual([])
    expect(lifecycle).toEqual([])
  })

  test("an allowed tool emits exactly one tool-running, before execution begins", async () => {
    const bus = new TypedBus()
    const seen = watch(bus)
    const lifecycle: string[] = []
    bus.on("tool-running", () => lifecycle.push("running"))

    // Mirror the processor: tool-start + tool-input precede execution.
    bus.emit("tool-start", { sessionId: "s-1", messageId: "m-1", partId: "p-1", tool: TOOL, callId: "call-1" })
    bus.emit("tool-input", { sessionId: "s-1", messageId: "m-1", partId: "p-1", tool: TOOL, callId: "call-1", input: { x: 1 } })

    const { run } = build(bus, createHookRegistry(), lifecycle)
    await run()
    // Mirror the processor's completion event.
    bus.emit("tool-end", { sessionId: "s-1", messageId: "m-1", partId: "p-1", tool: TOOL, callId: "call-1", status: "completed", output: "ok" })

    expect(lifecycle).toEqual(["running", "execute"])
    expect(seen.map((e) => e.name)).toEqual(["tool-start", "tool-input", "tool-running", "tool-end"])
  })
})
