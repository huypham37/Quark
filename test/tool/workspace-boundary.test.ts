// Workspace boundary tests
//
// Verify that the adapter extracts real file paths from tool arguments
// and passes them to the permission system, including boundary metadata.

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { z } from "zod"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { register, clear as clearRegistry } from "../../src/tool/registry"
import { defineTool } from "../../src/tool/tool"
import { resolveToolSet } from "../../src/tool/ai-adapter"
import { respond, _reset, type Ruleset } from "../../src/permission/permission"
import { bus } from "../../src/session/events"
import type { AgentConfig } from "../../src/agent"

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "quark-boundary-workspace-"))
  process.chdir(workspace)
  // process.chdir resolves symlinks on some platforms (e.g. /var -> /private/var),
  // so re-read the actual cwd to keep workspace in sync with process.cwd().
  workspace = process.cwd()
})

afterEach(() => {
  _reset()
  clearRegistry()
  bus.removeAllListeners("permission-request")
  rmSync(workspace, { recursive: true, force: true })
})

function makeAgent(ruleset: Ruleset = []): AgentConfig {
  return {
    id: "test-agent",
    name: "Test Agent",
    prompt: "test",
    tools: ["read", "write", "edit"],
    skills: [],
    permissions: ruleset,
  }
}

const readTool = defineTool({
  id: "read",
  description: "Read a file",
  parameters: z.object({ path: z.string() }),
  async execute(args) {
    return { title: "Read", output: `read ${args.path}`, metadata: {} }
  },
})

const writeTool = defineTool({
  id: "write",
  description: "Write a file",
  parameters: z.object({ path: z.string(), content: z.string() }),
  async execute(args) {
    writeFileSync(args.path, args.content)
    return { title: "Write", output: `wrote ${args.path}`, metadata: {} }
  },
})

const editTool = defineTool({
  id: "edit",
  description: "Edit a file",
  parameters: z.object({ path: z.string(), old: z.string(), new: z.string() }),
  async execute(args) {
    return { title: "Edit", output: `edited ${args.path}`, metadata: {} }
  },
})

test("external read triggers permission-request with real path", async () => {
  register(readTool)
  const agent = makeAgent()
  const tools = resolveToolSet(agent, "test-session", "msg-1", new AbortController().signal)

  const externalPath = "/etc/hosts"
  const events: any[] = []
  bus.on("permission-request", (data) => events.push(data))

  const promise = tools.read.execute({ path: externalPath }, { toolCallId: "call-1" })

  expect(events.length).toBe(1)
  expect(events[0]!.tool).toBe("read")
  expect(events[0]!.input.pattern).toBe(externalPath)
  expect(events[0]!.input.isExternal).toBe(true)
  expect(events[0]!.input.accessType).toBe("read")
  expect(typeof events[0]!.input.workspace).toBe("string")

  respond({ requestId: events[0]!.requestId, reply: "reject" })
  await expect(promise).rejects.toBeTruthy()
})

test("external write triggers permission-request with real path", async () => {
  register(writeTool)
  const agent = makeAgent()
  const tools = resolveToolSet(agent, "test-session", "msg-1", new AbortController().signal)

  const externalPath = "/etc/external-write-test.txt"
  const events: any[] = []
  bus.on("permission-request", (data) => events.push(data))

  const promise = tools.write.execute(
    { path: externalPath, content: "hello" },
    { toolCallId: "call-1" },
  )

  expect(events.length).toBe(1)
  expect(events[0]!.tool).toBe("write")
  expect(events[0]!.input.pattern).toBe(externalPath)
  expect(events[0]!.input.isExternal).toBe(true)
  expect(events[0]!.input.accessType).toBe("write")

  respond({ requestId: events[0]!.requestId, reply: "reject" })
  await expect(promise).rejects.toBeTruthy()
})

test("internal path does not set isExternal metadata", async () => {
  register(readTool)
  const agent = makeAgent()
  const tools = resolveToolSet(agent, "test-session", "msg-1", new AbortController().signal)

  mkdirSync(join(workspace, "src"), { recursive: true })
  writeFileSync(join(workspace, "src/app.ts"), "console.log('hi')")

  const events: any[] = []
  bus.on("permission-request", (data) => events.push(data))

  const promise = tools.read.execute({ path: "src/app.ts" }, { toolCallId: "call-1" })

  expect(events.length).toBe(1)
  // process.cwd() after chdir may resolve symlinks (e.g. /var → /private/var on macOS)
  expect(events[0]!.input.pattern).toBe(resolve(workspace, "src/app.ts"))
  expect(events[0]!.input.isExternal).toBeUndefined()

  respond({ requestId: events[0]!.requestId, reply: "reject" })
  await expect(promise).rejects.toBeTruthy()
})

test("external access still asks when profile allows every tool", async () => {
  register(readTool)
  const agent = makeAgent([{ tool: "*", pattern: "*", action: "allow" }])
  const tools = resolveToolSet(agent, "test-session", "msg-1", new AbortController().signal)
  const events: any[] = []
  bus.on("permission-request", (data) => events.push(data))

  const promise = tools.read.execute({ path: "/etc/hosts" }, { toolCallId: "call-1" })

  expect(events.length).toBe(1)
  expect(events[0]!.input.isExternal).toBe(true)
  respond({ requestId: events[0]!.requestId, reply: "reject" })
  await expect(promise).rejects.toBeTruthy()
})

test("profile permission pattern is preserved in ruleset", async () => {
  register(readTool)
  const ruleset: Ruleset = [
    { tool: "read", pattern: "*", action: "allow" },
    { tool: "read", pattern: `${workspace}/*`, action: "deny" },
  ]
  const agent = makeAgent(ruleset)
  const tools = resolveToolSet(agent, "test-session", "msg-1", new AbortController().signal)
  // An internal path matches the specific deny rule, which overrides allow *.
  await expect(
    tools.read.execute({ path: "src/app.ts" }, { toolCallId: "call-1" }),
  ).rejects.toMatchObject({ message: expect.stringContaining("permission rule") })
})
