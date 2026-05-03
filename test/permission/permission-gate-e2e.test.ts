import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { z } from "zod"
import { register, clear as clearRegistry } from "../../src/tool/registry"
import { defineTool, type ToolDef } from "../../src/tool/tool"
import { ask, respond, listPending, clearSession, _reset, RejectedError, CorrectedError, DeniedError, type Ruleset } from "../../src/permission/permission"
import { bus } from "../../src/session/events"

// ---------------------------------------------------------------------------
// Minimal AI SDK tool() wrapper — creates a tool with the same shape as
// the real toAITool() would produce, but without the AI SDK dependency.
// We test the permission gate logic directly by calling execute().
// ---------------------------------------------------------------------------

function makeAITool(def: ToolDef, ruleset: Ruleset) {
  const callId = "call-" + Math.random().toString(36).slice(2, 8)
  const sessionId = "test-session"
  const messageId = "test-msg"

  return {
    id: def.id,
    description: def.description,
    async execute(input: Record<string, unknown>, options?: { toolCallId?: string; abortSignal?: AbortSignal }) {
      // This mirrors toAITool() execute() — the permission gate BEFORE def.execute()
      const cid = options?.toolCallId ?? callId

      // 1. Permission gate
      try {
        await ask({
          sessionId,
          tool: def.id,
          pattern: "*",
          ruleset,
        });
      } catch (e) {
        if (e instanceof RejectedError || e instanceof CorrectedError) {
          // User rejected — abort the entire agent step
          bus.emit("permission-rejected", { sessionId });
        }
        throw e;
      }

      // 2. Signal running
      bus.emit("tool-running", { sessionId, messageId, callId: cid })

      // 3. Execute the actual tool
      const result = await def.execute(input, {
        sessionId,
        messageId,
        callId: cid,
        abort: options?.abortSignal ?? new AbortController().signal,
        async ask(tool: string, pattern: string) {
          await ask({ sessionId, tool, pattern, ruleset })
        },
      })

      return result
    },
  }
}

// ---------------------------------------------------------------------------
// Test tools
// ---------------------------------------------------------------------------

const readTool = defineTool({
  id: "read",
  description: "Read a file",
  parameters: z.object({ filePath: z.string() }),
  async execute(args) {
    return { title: "Read", output: `content of ${args.filePath}`, metadata: {} }
  },
})

const bashTool = defineTool({
  id: "bash",
  description: "Run a command",
  parameters: z.object({ command: z.string() }),
  async execute(args) {
    return { title: "Bash", output: `ran: ${args.command}`, metadata: {} }
  },
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: pre-execute permission gate", () => {
  beforeEach(() => {
    _reset()
    clearRegistry()
    register(readTool)
    register(bashTool)
  })

  afterEach(() => {
    _reset()
    clearRegistry()
  })

  // -------------------------------------------------------------------
  // allow — tool executes immediately, no pending request
  // -------------------------------------------------------------------

  it("allow rule: tool executes immediately, no permission prompt", async () => {
    const ruleset: Ruleset = [
      { tool: "read", pattern: "*", action: "allow" },
    ]
    const tool = makeAITool(readTool, ruleset)

    const result = await tool.execute({ filePath: "/tmp/test.txt" })

    expect(listPending()).toHaveLength(0)
    expect(result.output).toBe("content of /tmp/test.txt")
  })

  // -------------------------------------------------------------------
  // deny — tool throws DeniedError, def.execute() never called
  // -------------------------------------------------------------------

  it("deny rule: throws DeniedError, tool execute() never runs", async () => {
    const ruleset: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    const tool = makeAITool(bashTool, ruleset)

    await expect(
      tool.execute({ command: "rm -rf /" })
    ).rejects.toBeInstanceOf(DeniedError)

    expect(listPending()).toHaveLength(0)
  })

  it("deny rule does NOT emit permission-rejected (hard deny, not user rejection)", async () => {
    const ruleset: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    const tool = makeAITool(bashTool, ruleset)

    const rejectedCalls: string[] = []
    bus.on("permission-rejected", (data) => rejectedCalls.push(data.sessionId))

    await expect(tool.execute({ command: "rm" })).rejects.toBeInstanceOf(DeniedError)
    expect(rejectedCalls).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // deny wildcard — denies all tools
  // -------------------------------------------------------------------

  it("deny * rule: throws DeniedError for any tool", async () => {
    const ruleset: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    const tool = makeAITool(bashTool, ruleset)

    await expect(tool.execute({ command: "ls" })).rejects.toBeInstanceOf(DeniedError)
  })

  // -------------------------------------------------------------------
  // ask — blocks until user responds (once), then executes
  // -------------------------------------------------------------------

  it("ask rule: blocks until respond(once), then executes", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    // Start execution — it will block on ask()
    const execPromise = tool.execute({ filePath: "/tmp/test.txt" })

    // Verify a pending request exists
    await new Promise((r) => setTimeout(r, 10))
    const pending = listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].tool).toBe("read")

    // User responds "once"
    respond({ requestId: pending[0].id, reply: "once" })

    const result = await execPromise
    expect(result.output).toBe("content of /tmp/test.txt")
    expect(listPending()).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // ask → respond(always) → future calls auto-approved
  // -------------------------------------------------------------------

  it("ask rule: respond(always) adds session-scope allow, future calls skip prompt", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    // First call — blocked, user says "always"
    const p1 = tool.execute({ filePath: "/foo" })
    await new Promise((r) => setTimeout(r, 10))
    const pending = listPending()
    respond({ requestId: pending[0].id, reply: "always" })
    await p1
    expect(listPending()).toHaveLength(0)

    // Second call — should skip the prompt entirely
    const p2 = tool.execute({ filePath: "/bar" })
    // No pending request should appear
    await new Promise((r) => setTimeout(r, 10))
    expect(listPending()).toHaveLength(0)
    const result = await p2
    expect(result.output).toBe("content of /bar")
  })

  // -------------------------------------------------------------------
  // ask → respond(reject) → throws, tool execute() never runs
  // -------------------------------------------------------------------

  it("ask rule: respond(reject) throws RejectedError", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    const execPromise = tool.execute({ filePath: "/tmp/secret.txt" })
    await new Promise((r) => setTimeout(r, 10))
    const pending = listPending()

    respond({ requestId: pending[0].id, reply: "reject" })

    await expect(execPromise).rejects.toBeInstanceOf(RejectedError)
    expect(listPending()).toHaveLength(0)
  })

  it("ask rule: respond(reject) emits permission-rejected event", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    const rejectedCalls: string[] = []
    bus.on("permission-rejected", (data) => rejectedCalls.push(data.sessionId))

    const execPromise = tool.execute({ filePath: "/tmp/secret.txt" })
    await new Promise((r) => setTimeout(r, 10))
    respond({ requestId: listPending()[0].id, reply: "reject" })

    await expect(execPromise).rejects.toBeInstanceOf(RejectedError)
    expect(rejectedCalls).toEqual(["test-session"])
  })

  it("ask rule: respond(reject) with message emits permission-rejected", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    const rejectedCalls: string[] = []
    bus.on("permission-rejected", (data) => rejectedCalls.push(data.sessionId))

    const execPromise = tool.execute({ filePath: "/tmp/secret.txt" })
    await new Promise((r) => setTimeout(r, 10))
    respond({ requestId: listPending()[0].id, reply: "reject", message: "No access" })

    await expect(execPromise).rejects.toBeInstanceOf(CorrectedError)
    expect(rejectedCalls).toEqual(["test-session"])
  })

  // -------------------------------------------------------------------
  // Last-match-wins — later rule overrides earlier one
  // -------------------------------------------------------------------

  it("last-match-wins: later deny overrides earlier allow", async () => {
    const ruleset: Ruleset = [
      { tool: "bash", pattern: "*", action: "allow" },
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    const tool = makeAITool(bashTool, ruleset)

    await expect(tool.execute({ command: "ls" })).rejects.toBeInstanceOf(DeniedError)
  })

  it("last-match-wins: later allow overrides earlier deny", async () => {
    const ruleset: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
      { tool: "bash", pattern: "*", action: "allow" },
    ]
    const tool = makeAITool(bashTool, ruleset)

    const result = await tool.execute({ command: "ls" })
    expect(result.output).toBe("ran: ls")
  })

  // -------------------------------------------------------------------
  // Multiple tools, different rules
  // -------------------------------------------------------------------

  it("different rules for different tools work independently", async () => {
    const ruleset: Ruleset = [
      { tool: "read", pattern: "*", action: "allow" },
      { tool: "bash", pattern: "*", action: "deny" },
    ]

    const read = makeAITool(readTool, ruleset)
    const bash = makeAITool(bashTool, ruleset)

    // read: allowed
    const r1 = await read.execute({ filePath: "/tmp/a.txt" })
    expect(r1.output).toContain("content of")

    // bash: denied
    await expect(bash.execute({ command: "ls" })).rejects.toBeInstanceOf(DeniedError)
  })

  // -------------------------------------------------------------------
  // tool-running event is emitted after permission passes
  // -------------------------------------------------------------------

  it("emits tool-running event after permission passes", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "allow" }]
    const tool = makeAITool(readTool, ruleset)

    const received: any[] = []
    bus.on("tool-running", (data) => received.push(data))

    await tool.execute({ filePath: "/tmp/x.txt" })

    expect(received).toHaveLength(1)
    expect(received[0].sessionId).toBe("test-session")
    expect(received[0].callId).toBeDefined()
    expect(received[0].messageId).toBe("test-msg")
  })

  it("does NOT emit tool-running when permission is denied", async () => {
    const ruleset: Ruleset = [{ tool: "bash", pattern: "*", action: "deny" }]
    const tool = makeAITool(bashTool, ruleset)

    const received: any[] = []
    bus.on("tool-running", (data) => received.push(data))

    await expect(tool.execute({ command: "bad" })).rejects.toBeInstanceOf(DeniedError)
    expect(received).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // Empty ruleset → default "ask"
  // -------------------------------------------------------------------

  it("empty ruleset defaults to ask — blocks until respond", async () => {
    const ruleset: Ruleset = []
    const tool = makeAITool(readTool, ruleset)

    const execPromise = tool.execute({ filePath: "/tmp/y.txt" })
    await new Promise((r) => setTimeout(r, 10))

    expect(listPending()).toHaveLength(1)
    respond({ requestId: listPending()[0].id, reply: "once" })

    const result = await execPromise
    expect(result.output).toBe("content of /tmp/y.txt")
  })

  // -------------------------------------------------------------------
  // clearSession releases pending requests
  // -------------------------------------------------------------------

  it("clearSession releases blocked permission request", async () => {
    const ruleset: Ruleset = [{ tool: "read", pattern: "*", action: "ask" }]
    const tool = makeAITool(readTool, ruleset)

    const execPromise = tool.execute({ filePath: "/tmp/z.txt" })
    await new Promise((r) => setTimeout(r, 10))

    expect(listPending()).toHaveLength(1)
    clearSession("test-session")

    await expect(execPromise).rejects.toBeInstanceOf(RejectedError)
    expect(listPending()).toHaveLength(0)
  })
})
