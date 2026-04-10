// Tests for Issue #102: Immediate abort/cancel of agent during tool execution
//
// The bug: when the user presses Esc while a tool is executing, the AbortSignal
// fires but the loop blocks until the tool's promise resolves — the abort has no
// effect until the tool finishes naturally.
//
// The fix has two parts:
//   1. Wrap def.execute() in Promise.race() against the abort signal in toAITool()
//      so an abort immediately wins the race regardless of how slow the tool is.
//   2. Add the signal option to execAsync() in the bash tool's regular (non-sub-agent)
//      path so the underlying child process is killed when the signal fires.
//
// These tests verify both behaviours in isolation without requiring a live LLM.

import { describe, it, expect } from "bun:test"
import { spawn } from "child_process"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Helpers — replicate the primitives that the fix will introduce
// ---------------------------------------------------------------------------

/**
 * Convert an AbortSignal to a Promise that rejects with an AbortError.
 *
 * - If the signal is already aborted, the promise rejects synchronously
 *   (on the next microtask tick via Promise.reject).
 * - Otherwise the rejection is deferred until the signal fires.
 *
 * This is the helper that toAITool() will use inside Promise.race().
 */
function abortSignalToPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    )
  }
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
        )
      },
      { once: true },
    )
  })
}

/**
 * Simulate the Promise.race() pattern that toAITool() will use.
 *
 * Races the given tool promise against the abort signal.
 * If the signal fires first, rejects immediately with an AbortError.
 * If the tool completes first, resolves with the tool's result.
 */
function raceWithAbort<T>(toolPromise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([toolPromise, abortSignalToPromise(signal)])
}

// ---------------------------------------------------------------------------
// Test 1: abortSignalToPromise — the foundational helper
// ---------------------------------------------------------------------------

describe("abortSignalToPromise", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort() // abort before the call

    let caughtError: Error | undefined
    try {
      await abortSignalToPromise(controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    expect(caughtError).toBeDefined()
    expect(caughtError!.name).toBe("AbortError")
  })

  it("rejects after the signal fires with AbortError", async () => {
    const controller = new AbortController()
    const start = Date.now()

    setTimeout(() => controller.abort(), 50)

    let caughtError: Error | undefined
    try {
      await abortSignalToPromise(controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    const elapsed = Date.now() - start
    expect(caughtError).toBeDefined()
    expect(caughtError!.name).toBe("AbortError")
    // Should reject close to when the signal fired (~50ms), not after a long wait
    expect(elapsed).toBeGreaterThanOrEqual(40)
    expect(elapsed).toBeLessThan(500)
  })

  it("rejection carries the name AbortError (not a generic Error)", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    let caughtError: Error | undefined
    try {
      await abortSignalToPromise(controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    // The error.name must be 'AbortError' so isRetryable() skips retry logic
    expect(caughtError!.name).toBe("AbortError")
    expect(caughtError!.message).toMatch(/aborted/i)
  })
})

// ---------------------------------------------------------------------------
// Test 2: Promise.race() abort pattern — toAITool() behavior
// ---------------------------------------------------------------------------

describe("toAITool abort race — Promise.race() pattern", () => {
  it("resolves with tool result when tool finishes before abort fires", async () => {
    const controller = new AbortController()

    // Tool finishes in 30ms, abort fires at 200ms — tool wins
    const slowTool = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 30))
    setTimeout(() => controller.abort(), 200)

    const result = await raceWithAbort(slowTool, controller.signal)
    expect(result).toBe("done")
  })

  it("rejects with AbortError when abort fires before tool finishes", async () => {
    const controller = new AbortController()

    // Tool takes 5 seconds, abort fires at 50ms — abort wins immediately
    const slowTool = new Promise<string>((resolve) =>
      setTimeout(() => resolve("tool done"), 5_000),
    )

    const start = Date.now()
    setTimeout(() => controller.abort(), 50)

    let caughtError: Error | undefined
    try {
      await raceWithAbort(slowTool, controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    const elapsed = Date.now() - start

    // Must reject with an AbortError
    expect(caughtError).toBeDefined()
    expect(caughtError!.name).toBe("AbortError")

    // Must reject quickly (within 50ms of abort), NOT wait for the 5s tool
    // We allow generous headroom: abort at ~50ms, so elapsed should be < 300ms
    expect(elapsed).toBeLessThan(300)
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it("abort on already-aborted signal rejects synchronously (next microtask)", async () => {
    const controller = new AbortController()
    controller.abort() // abort before racing

    const neverResolves = new Promise<string>(() => {
      // intentionally never resolves
    })

    const start = Date.now()
    let caughtError: Error | undefined
    try {
      await raceWithAbort(neverResolves, controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    const elapsed = Date.now() - start

    expect(caughtError).toBeDefined()
    expect(caughtError!.name).toBe("AbortError")
    // Should reject essentially immediately (< 50ms) since signal was pre-aborted
    expect(elapsed).toBeLessThan(50)
  })

  it("abort timing: verifies the race resolves at signal time, not tool completion time", async () => {
    const TOOL_DURATION_MS = 5_000 // 5s — simulates a slow tool
    const ABORT_DELAY_MS = 50 // 50ms — abort fires quickly

    const controller = new AbortController()

    const slowTool = new Promise<string>((resolve) =>
      setTimeout(() => resolve("tool finished"), TOOL_DURATION_MS),
    )

    const start = Date.now()
    setTimeout(() => controller.abort(), ABORT_DELAY_MS)

    let caughtError: Error | undefined
    try {
      await raceWithAbort(slowTool, controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    const elapsed = Date.now() - start

    expect(caughtError!.name).toBe("AbortError")

    // The key assertion: elapsed should be close to ABORT_DELAY_MS (~50ms),
    // NOT close to TOOL_DURATION_MS (5000ms).
    // Generous upper bound: 10x the abort delay to allow for CI slowness.
    expect(elapsed).toBeLessThan(ABORT_DELAY_MS * 10)
    expect(elapsed).toBeGreaterThanOrEqual(ABORT_DELAY_MS - 20)
  })
})

// ---------------------------------------------------------------------------
// Test 3: bash tool regular path — subprocess killed on abort
// ---------------------------------------------------------------------------

describe("bash tool regular path — abort kills subprocess", () => {
  /**
   * Simulates the bash tool's regular (non-sub-agent) exec path
   * with the abort signal wired in via execAsync signal option.
   *
   * This is the fix: pass `signal` to execAsync() so Node.js kills the
   * child process when the AbortController fires, instead of waiting for
   * the command to complete naturally.
   */
  async function execWithAbort(
    command: string,
    signal: AbortSignal,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; killed: boolean }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        signal, // <-- the fix: wire the abort signal into execAsync
      })
      return { stdout, stderr, exitCode: 0, killed: false }
    } catch (err: any) {
      // When the signal fires, execAsync rejects with an AbortError (name: 'AbortError')
      // or with kill signal info depending on the Node/Bun version.
      const killed =
        err.name === "AbortError" ||
        err.killed === true ||
        err.signal != null ||
        (err.message && err.message.toLowerCase().includes("abort"))
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: err.code ?? null,
        killed,
      }
    }
  }

  it("completes quickly and without error for a fast command", async () => {
    const controller = new AbortController()
    const start = Date.now()

    const result = await execWithAbort("echo hello", controller.signal)

    const elapsed = Date.now() - start
    expect(result.killed).toBe(false)
    expect(result.stdout.trim()).toBe("hello")
    expect(elapsed).toBeLessThan(2_000)
  })

  it("kills a sleep 10 subprocess when abort fires after 100ms", async () => {
    const controller = new AbortController()
    const start = Date.now()

    // Abort after 100ms — the subprocess should die immediately, not after 10 seconds
    setTimeout(() => controller.abort(), 100)

    const result = await execWithAbort("sleep 10", controller.signal)

    const elapsed = Date.now() - start

    // The critical assertion: the command must complete in under 1 second,
    // NOT after the full 10 seconds.
    expect(elapsed).toBeLessThan(1_000)
    expect(elapsed).toBeGreaterThanOrEqual(90)

    // The result must indicate the process was killed/aborted
    expect(result.killed).toBe(true)
  })

  it("abort on pre-aborted signal kills subprocess before it starts", async () => {
    const controller = new AbortController()
    controller.abort() // abort before exec

    const start = Date.now()
    const result = await execWithAbort("sleep 10", controller.signal)
    const elapsed = Date.now() - start

    // Should fail immediately — well under 1 second
    expect(elapsed).toBeLessThan(500)
    expect(result.killed).toBe(true)
  })

  it("does NOT kill the process if abort fires after completion", async () => {
    const controller = new AbortController()

    // abort fires 500ms after — 'echo' will be done long before that
    setTimeout(() => controller.abort(), 500)

    const start = Date.now()
    const result = await execWithAbort("echo finished", controller.signal)
    const elapsed = Date.now() - start

    // Should complete quickly and cleanly
    expect(result.killed).toBe(false)
    expect(result.stdout.trim()).toBe("finished")
    expect(elapsed).toBeLessThan(500)
  })
})

// ---------------------------------------------------------------------------
// Test 4: spawn-based bash tool — abort kills subprocess via ctx.abort
// ---------------------------------------------------------------------------

describe("bash tool spawn path — abort kills subprocess via ctx.abort listener", () => {
  /**
   * Simulates the spawn-based abort path used in examples/tools/bash.ts.
   *
   * This is the existing sub-agent path. We test that the onAbort listener
   * wired to ctx.abort correctly terminates the process.
   */
  function spawnWithAbort(
    command: string,
    signal: AbortSignal,
  ): Promise<{ output: string; killed: boolean; exitCode: number | null }> {
    // If already aborted, short-circuit without spawning
    if (signal.aborted) {
      return Promise.resolve({ output: "(aborted before spawn)", killed: true, exitCode: null })
    }

    return new Promise((resolve) => {
      let output = ""
      let killed = false

      const proc = spawn("sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      proc.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })
      proc.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })

      const onAbort = () => {
        killed = true
        proc.kill("SIGTERM")
      }
      signal.addEventListener("abort", onAbort, { once: true })

      proc.on("close", (code) => {
        signal.removeEventListener("abort", onAbort)
        resolve({ output, killed, exitCode: code })
      })

      proc.on("error", (err: Error) => {
        signal.removeEventListener("abort", onAbort)
        resolve({ output: err.message, killed, exitCode: null })
      })
    })
  }

  it("kills a long-running subprocess when the abort signal fires", async () => {
    const controller = new AbortController()
    const start = Date.now()

    setTimeout(() => controller.abort(), 100)

    const result = await spawnWithAbort("sleep 10", controller.signal)

    const elapsed = Date.now() - start
    expect(result.killed).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
    expect(elapsed).toBeGreaterThanOrEqual(90)
  })

  it("resolves naturally when command finishes before abort fires", async () => {
    const controller = new AbortController()

    // abort fires after 500ms — command finishes in milliseconds
    setTimeout(() => controller.abort(), 500)

    const result = await spawnWithAbort("echo natural", controller.signal)

    expect(result.killed).toBe(false)
    expect(result.output.trim()).toBe("natural")
    expect(result.exitCode).toBe(0)
  })

  it("handles abort on already-aborted signal without hanging", async () => {
    const controller = new AbortController()
    controller.abort()

    const start = Date.now()
    const result = await spawnWithAbort("sleep 10", controller.signal)
    const elapsed = Date.now() - start

    // The listener fires synchronously when added to an already-aborted signal
    expect(result.killed).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })
})

// ---------------------------------------------------------------------------
// Test 5: integration — raceWithAbort wrapping a slow tool execute()
// ---------------------------------------------------------------------------

describe("toAITool integration — raceWithAbort wrapping a ToolDef.execute()", () => {
  /**
   * A mock ToolDef that takes a configurable duration to complete.
   * Mirrors the shape of ToolDef<T> from src/tool/tool.ts.
   */
  function makeSlowTool(durationMs: number) {
    return {
      id: "slow-tool",
      description: "A slow tool for testing abort behavior",
      async execute(_args: unknown, _ctx: unknown): Promise<{ output: string }> {
        await new Promise((resolve) => setTimeout(resolve, durationMs))
        return { output: `completed after ${durationMs}ms` }
      },
    }
  }

  /**
   * Simulates what toAITool().execute() will do after the fix:
   *
   *   const toolResult = await Promise.race([
   *     def.execute(args, ctx),
   *     abortSignalToPromise(abort),
   *   ])
   */
  async function executeWithRace(
    toolFn: () => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return Promise.race([toolFn(), abortSignalToPromise(signal)])
  }

  it("returns tool result when tool finishes before abort", async () => {
    const controller = new AbortController()
    const tool = makeSlowTool(30) // 30ms tool

    setTimeout(() => controller.abort(), 300) // abort at 300ms

    const result = await executeWithRace(
      () => tool.execute({}, {}),
      controller.signal,
    ) as { output: string }

    expect(result.output).toContain("completed after 30ms")
  })

  it("raises AbortError immediately when tool is still executing at abort time", async () => {
    const controller = new AbortController()
    const tool = makeSlowTool(5_000) // 5 second tool — simulates a real slow tool

    const start = Date.now()
    setTimeout(() => controller.abort(), 50) // abort at 50ms

    let caughtError: Error | undefined
    try {
      await executeWithRace(() => tool.execute({}, {}), controller.signal)
    } catch (err) {
      caughtError = err as Error
    }

    const elapsed = Date.now() - start

    // Must abort, not wait for the 5s tool
    expect(caughtError).toBeDefined()
    expect(caughtError!.name).toBe("AbortError")

    // Must complete close to abort time (~50ms), not tool completion time (5000ms)
    expect(elapsed).toBeLessThan(500)
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it("abort does not suppress the AbortError — it propagates to the caller", async () => {
    const controller = new AbortController()
    const tool = makeSlowTool(5_000)

    setTimeout(() => controller.abort(), 30)

    const result = await executeWithRace(
      () => tool.execute({}, {}),
      controller.signal,
    ).catch((err: Error) => err) // catch and return the error instead of throwing

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).name).toBe("AbortError")
  })
})
