import { describe, it, expect, beforeEach } from "bun:test"
import {
  resolve,
  registerMethod,
  setDefaultMethod,
  isRunning,
  setPending,
  takePending,
  hasPending,
  _reset,
  type CompactMethodDef,
  type CompactMethodContext,
  type CompactResult,
} from "../../src/session/compact-resolver"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(sessionId = "sess-1"): CompactMethodContext {
  return {
    sessionId,
    messages: [],
    parts: [],
    modelMessages: [],
    model: {} as any,
    agentPrompt: "",
    budget: null,
    persist: {
      createMessage: (() => {}) as any,
      addPart: (() => {}) as any,
      finishMessage: (() => {}) as any,
      saveUserMessage: (() => {}) as any,
    },
    session: {
      create: (() => {}) as any,
    },
  }
}

function makeMethod(
  id: string,
  executeFn?: (ctx: CompactMethodContext) => Promise<CompactResult>,
): CompactMethodDef {
  return {
    id,
    description: `Test method ${id}`,
    parameters: {},
    execute: executeFn ?? (async () => ({ type: "compacted" as const, summary: "done", evictedCount: 5 })),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compact-resolver", () => {
  beforeEach(() => {
    _reset()
  })

  // ---- Method registration ----

  describe("registerMethod / setDefaultMethod", () => {
    it("registers and resolves a method", async () => {
      registerMethod(makeMethod("anchored"))
      setDefaultMethod("anchored")

      const result = await resolve({ trigger: "command", ctx: makeCtx() })
      expect(result.type).toBe("compacted")
    })

    it("throws when setting default to unregistered method", () => {
      expect(() => setDefaultMethod("nope")).toThrow("Compact method not found: nope")
    })
  })

  // ---- resolve() errors ----

  describe("resolve() errors", () => {
    it("throws when no default method is configured", async () => {
      await expect(resolve({ trigger: "auto", ctx: makeCtx() })).rejects.toThrow(
        "No compaction method configured",
      )
    })

    it("throws descriptive error for unknown method", async () => {
      registerMethod(makeMethod("anchored"))
      setDefaultMethod("anchored")

      await expect(
        resolve({ trigger: "auto", ctx: makeCtx(), methodId: "nonexistent" }),
      ).rejects.toThrow('Unknown compaction method: "nonexistent". Available: anchored')
    })
  })

  // ---- Deduplication ----

  describe("deduplication", () => {
    it("calling resolve() twice for same session only runs execute once", async () => {
      let callCount = 0
      let resolveExec: (() => void) | null = null

      const slowMethod = makeMethod("slow", () => {
        callCount++
        return new Promise<CompactResult>((r) => {
          resolveExec = () => r({ type: "compacted", summary: "done", evictedCount: 3 })
        })
      })

      registerMethod(slowMethod)
      setDefaultMethod("slow")

      const ctx = makeCtx("sess-dedup")
      const p1 = resolve({ trigger: "auto", ctx })
      const p2 = resolve({ trigger: "command", ctx })

      // Both should return the same promise
      expect(isRunning("sess-dedup")).toBe(true)
      expect(callCount).toBe(1)

      // Resolve the execution
      resolveExec!()
      const [r1, r2] = await Promise.all([p1, p2])

      expect(r1).toEqual(r2)
      expect(r1.type).toBe("compacted")
      expect(isRunning("sess-dedup")).toBe(false)
    })

    it("allows new execution after previous completes", async () => {
      let callCount = 0
      registerMethod(
        makeMethod("counter", async () => {
          callCount++
          return { type: "compacted", summary: `run-${callCount}`, evictedCount: 1 }
        }),
      )
      setDefaultMethod("counter")

      const ctx = makeCtx("sess-seq")
      const r1 = await resolve({ trigger: "auto", ctx })
      const r2 = await resolve({ trigger: "auto", ctx })

      expect(callCount).toBe(2)
      expect((r1 as any).summary).toBe("run-1")
      expect((r2 as any).summary).toBe("run-2")
    })
  })

  // ---- Pending state ----

  describe("pending state", () => {
    it("stores and retrieves pending request", () => {
      const ctx = makeCtx("sess-p")
      setPending("sess-p", { trigger: "auto", ctx })

      expect(hasPending("sess-p")).toBe(true)
      const req = takePending("sess-p")

      expect(req).toBeDefined()
      expect(req!.trigger).toBe("auto")
      expect(req!.ctx.sessionId).toBe("sess-p")

      // takePending removes it
      expect(hasPending("sess-p")).toBe(false)
      expect(takePending("sess-p")).toBeUndefined()
    })

    it("returns undefined when no pending request", () => {
      expect(takePending("nobody")).toBeUndefined()
      expect(hasPending("nobody")).toBe(false)
    })
  })

  // ---- Explicit methodId override ----

  describe("methodId override", () => {
    it("uses explicit methodId instead of default", async () => {
      registerMethod(makeMethod("method-a", async () => ({ type: "compacted", summary: "a", evictedCount: 1 })))
      registerMethod(makeMethod("method-b", async () => ({ type: "handoff", reason: "too big" })))
      setDefaultMethod("method-a")

      const result = await resolve({ trigger: "tool", ctx: makeCtx(), methodId: "method-b" })
      expect(result.type).toBe("handoff")
    })
  })

  // ---- Result types ----

  describe("result types", () => {
    it("returns compacted result", async () => {
      registerMethod(
        makeMethod("comp", async () => ({ type: "compacted", summary: "summary text", evictedCount: 8 })),
      )
      setDefaultMethod("comp")

      const result = await resolve({ trigger: "auto", ctx: makeCtx() })
      expect(result).toEqual({ type: "compacted", summary: "summary text", evictedCount: 8 })
    })

    it("returns handoff result", async () => {
      registerMethod(
        makeMethod("ho", async () => ({ type: "handoff", reason: "context too large for compaction" })),
      )
      setDefaultMethod("ho")

      const result = await resolve({ trigger: "auto", ctx: makeCtx() })
      expect(result).toEqual({ type: "handoff", reason: "context too large for compaction" })
    })
  })
})
