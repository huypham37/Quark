import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bus } from "../../src/session/events"
import { SUBAGENT_EVENT_PREFIX, parseChildEventLine } from "../../src/subagent/protocol"
import { runSubagent, SubagentExecutionError } from "../../src/subagent/supervisor"
import type { ToolContext } from "../../src/tool/tool"

const originalExecutable = process.env.QUARK_SUBAGENT_EXECUTABLE
const tempDirs: string[] = []

afterEach(() => {
  if (originalExecutable === undefined) delete process.env.QUARK_SUBAGENT_EXECUTABLE
  else process.env.QUARK_SUBAGENT_EXECUTABLE = originalExecutable
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  bus.removeAllListeners("subagent-tool-start")
  bus.removeAllListeners("subagent-tool-input")
  bus.removeAllListeners("subagent-tool-running")
  bus.removeAllListeners("subagent-tool-end")
  bus.removeAllListeners("subagent-done")
  bus.removeAllListeners("subagent-error")
})

function context(abort = new AbortController()): ToolContext {
  return { sessionId: "parent-session", messageId: "parent-message", callId: "parent-call", abort: abort.signal }
}

function fixture(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "quark-subagent-fixture-"))
  tempDirs.push(dir)
  const file = join(dir, "child.ts")
  writeFileSync(file, `#!/usr/bin/env bun\n${source}`)
  chmodSync(file, 0o755)
  return file
}

describe("subagent protocol", () => {
  test("parses typed child lifecycle events", () => {
    expect(parseChildEventLine(`${SUBAGENT_EVENT_PREFIX}{"e":"tool-running","id":"call-1"}`)).toEqual({ e: "tool-running", id: "call-1" })
    expect(parseChildEventLine("ordinary stderr")).toBeNull()
    expect(() => parseChildEventLine(`${SUBAGENT_EVENT_PREFIX}{"e":"tool-start"}`)).toThrow("Invalid subagent event")
  })

  test("rejects removed permission event variants", () => {
    expect(() => parseChildEventLine(`${SUBAGENT_EVENT_PREFIX}{"e":"permission-request","id":"p"}`)).toThrow("Invalid subagent event")
  })
})

describe("runSubagent", () => {
  test("forwards normal lifecycle events and returns child output without stdin control", async () => {
    process.env.QUARK_SUBAGENT_EXECUTABLE = fixture(`
const p = "${SUBAGENT_EVENT_PREFIX}"
console.error(p + JSON.stringify({ e: "ready", sessionId: "child", profile: "finder" }))
console.error(p + JSON.stringify({ e: "tool-start", t: "read", id: "child-call" }))
console.error(p + JSON.stringify({ e: "tool-input", t: "read", id: "child-call", in: { path: "x" } }))
console.error(p + JSON.stringify({ e: "tool-running", id: "child-call" }))
console.error(p + JSON.stringify({ e: "tool-end", t: "read", id: "child-call", s: "completed" }))
console.error(p + JSON.stringify({ e: "loop-end" }))
console.log("done")
`)
    const lifecycle: string[] = []
    bus.on("subagent-tool-start", () => lifecycle.push("start"))
    bus.on("subagent-tool-input", () => lifecycle.push("input"))
    bus.on("subagent-tool-running", () => lifecycle.push("running"))
    bus.on("subagent-tool-end", () => lifecycle.push("end"))
    bus.on("subagent-done", () => lifecycle.push("done"))

    await expect(runSubagent({ profile: "finder", prompt: "hello" }, context())).resolves.toMatchObject({ output: "done", childSessionId: "child" })
    expect(lifecycle).toEqual(["start", "input", "running", "end", "done"])
  })

  test("surfaces malformed child events as protocol failures", async () => {
    process.env.QUARK_SUBAGENT_EXECUTABLE = fixture(`
console.error("${SUBAGENT_EVENT_PREFIX}{\\"e\\":\\"tool-start\\"}")
console.error("${SUBAGENT_EVENT_PREFIX}" + JSON.stringify({ e: "loop-end" }))
`)
    await expect(runSubagent({ profile: "finder", prompt: "hello" }, context())).rejects.toBeInstanceOf(SubagentExecutionError)
  })
})
