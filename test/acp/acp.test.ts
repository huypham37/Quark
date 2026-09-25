// QUA-242 self-check: ACP composition root + `quark acp` stdio contract.
//
// Covers the parts QUA-242 owns: index.ts composition, strict NDJSON stdout,
// stderr diagnostics, and EOF cleanup (connection close disposes sessions).

import { describe, expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { createAcpAgent } from "../../packages/acp/src/index"
import type { Runner } from "@quark/runner"

// session/new and initialize never touch the runner; it is created lazily on
// first prompt. A bare stub is enough to exercise composition.
const stubRunner = {} as Runner

describe("createAcpAgent", () => {
  test("initialize and session/new compose through the SDK", async () => {
    const agent = createAcpAgent({ createRunner: () => stubRunner })
    await acp.client({ name: "selfcheck" }).connectWith(agent.app, async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })
      expect(init.protocolVersion).toBe(acp.PROTOCOL_VERSION)
      expect(init.agentInfo?.name).toBe("quark")

      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      expect(typeof sessionId).toBe("string")
    })
  })

  test("rejects unsupported protocol version", async () => {
    const agent = createAcpAgent({ createRunner: () => stubRunner })
    await acp.client({ name: "selfcheck" }).connectWith(agent.app, async (ctx) => {
      await expect(
        ctx.request(acp.methods.agent.initialize, { protocolVersion: 999 }),
      ).rejects.toBeDefined()
    })
  })
})

describe("quark acp stdio", () => {
  test("serves NDJSON on stdout, diagnostics on stderr, exits cleanly on EOF", async () => {
    const repoRoot = new URL("../..", import.meta.url).pathname
    const proc = Bun.spawn({
      cmd: [process.execPath, "packages/quark/src/cli.ts", "acp"],
      cwd: repoRoot,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, QUARK_CONFIG_DIR: `${import.meta.dir}/.tmp-config` },
    })

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} },
      }) + "\n",
    )
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: repoRoot, mcpServers: [] },
      }) + "\n",
    )
    // EOF: the agent must cancel active work, close, and exit 0 — not hang.
    proc.stdin.end()

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    const lines = stdout.trim().split("\n").filter(Boolean)
    expect(lines.length).toBe(2)
    const responses = lines.map((line) => JSON.parse(line))
    expect(responses[0].jsonrpc).toBe("2.0")
    expect(responses[0].id).toBe(1)
    expect(responses[0].result.protocolVersion).toBe(acp.PROTOCOL_VERSION)
    expect(responses[1].id).toBe(2)
    expect(typeof responses[1].result.sessionId).toBe("string")
    expect(exitCode).toBe(0)
    expect(stderr).toContain("[quark acp]")
  }, 30_000)
})
