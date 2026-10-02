import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { resolveToolSet } from "../../packages/runner/src/tool/ai-adapter"
import { setCurrentTurn, undoLatest } from "../../packages/runner/src/commands/undo"
import { setSessionStorageRoot } from "../../packages/runner/src/storage/session-path"

const originalCwd = process.cwd
let dir: string
let turn = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quark-adapter-undo-"))
  process.cwd = () => dir
  setSessionStorageRoot(join(dir, "sessions"))
})
afterEach(() => {
  process.cwd = originalCwd
  setSessionStorageRoot(undefined)
  rmSync(dir, { recursive: true, force: true })
})

describe("filesystem tool undo boundary", () => {
  for (const id of ["write", "edit"]) {
    for (const field of ["filePath", "path"]) {
      test(`${id} with ${field}: snapshot precedes execution and undo restores`, async () => {
        const file = join(dir, "target.txt")
        writeFileSync(file, "before")
        const session = `adapter-${++turn}`
        setCurrentTurn(session, `message-${turn}`)
        const def: any = {
          id,
          description: "test filesystem tool",
          parameters: z.object({ [field]: z.string() }),
          execute: async (args: Record<string, string>) => {
            writeFileSync(args[field]!, "after")
            return { title: id, output: "ok" }
          },
        }
        const tools = resolveToolSet({ tools: [def] }, session, `message-${turn}`, new AbortController().signal)
        await (tools[id] as any).execute({ [field]: file }, { toolCallId: "call" })
        expect(readFileSync(file, "utf8")).toBe("after")
        expect((await undoLatest(session))?.restored).toEqual(["target.txt"])
        expect(readFileSync(file, "utf8")).toBe("before")
      })
    }
  }

  test("ambiguous targets fail closed without executing the tool", async () => {
    const session = `adapter-${++turn}`
    setCurrentTurn(session, `message-${turn}`)
    let executed = false
    const def: any = {
      id: "write", description: "test", parameters: z.object({ path: z.string(), filePath: z.string() }),
      execute: async () => { executed = true; return { title: "write", output: "ok" } },
    }
    const tools = resolveToolSet({ tools: [def] }, session, `message-${turn}`, new AbortController().signal)
    await expect((tools.write as any).execute({ path: "a", filePath: "b" }, { toolCallId: "call" })).rejects.toThrow(/unambiguous/)
    expect(executed).toBe(false)
  })
})
