// QUA-243 subprocess fixture.
//
// Runs the REAL production transport (`runAcpStdio`) over actual process stdio,
// with a scripted fake runner injected instead of a model-backed one. No
// network, no provider, no tools run: every behavior is selected by the prompt
// text so the test can drive it purely through the protocol.
//
//   * "BLOCK" -> the turn never finishes until `session/cancel` (or teardown)
//   * "TOOL"  -> additionally emits a full tool-call lifecycle
//
// Each chunk echoes `echo[<runnerSessionId>]:<text>` so the client can observe
// which runner (and therefore which session) answered. A `seeded-1` session is
// pre-persisted so `session/list`/`session/resume` have something to adopt.

import { createSession, MemorySessionStore, type Runner, type SessionStore } from "@quark/runner"
import { runAcpStdio } from "../../../packages/acp/src/index"

type Listener = (data: any) => void

function makeBus() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    on(name: string, fn: Listener) {
      const set = listeners.get(name) ?? new Set<Listener>()
      set.add(fn)
      listeners.set(name, set)
    },
    off(name: string, fn: Listener) {
      listeners.get(name)?.delete(fn)
    },
    emit(name: string, data: unknown) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(data)
    },
  }
}

let sequence = 0

function makeFakeRunner(store: SessionStore, cwd: string): Runner {
  const bus = makeBus()
  let active = false
  let rejectTurn: ((error: unknown) => void) | null = null

  const runner = {
    bus,
    store,
    async prompt(input: { sessionId?: string; parts: { type: "text"; text: string }[] }) {
      const sessionId = input.sessionId ?? `runner-${++sequence}`
      if (!store.get(sessionId)) createSession({ id: sessionId, directory: cwd }, store)
      // The engine announces creation synchronously, before the turn awaits, so
      // the session bridge can latch the runner id for cancellation.
      bus.emit("session-created", { sessionId })

      active = true
      const text = input.parts.map((part) => part.text).join(" ")
      bus.emit("text-delta", {
        sessionId,
        messageId: "m1",
        partId: "p1",
        delta: `echo[${sessionId}]:${text}`,
        text: `echo[${sessionId}]:${text}`,
      })

      if (text.includes("TOOL")) {
        bus.emit("tool-start", {
          sessionId,
          messageId: "m1",
          partId: "t1",
          tool: "read",
          callId: "call-1",
        })
        bus.emit("tool-input", {
          sessionId,
          messageId: "m1",
          partId: "t1",
          tool: "read",
          callId: "call-1",
          input: { filePath: "/tmp/a.ts" },
        })
        bus.emit("tool-running", { sessionId, messageId: "m1", callId: "call-1" })
        bus.emit("tool-end", {
          sessionId,
          messageId: "m1",
          partId: "t1",
          tool: "read",
          callId: "call-1",
          status: "completed",
          output: "contents",
        })
      }

      if (text.includes("BLOCK")) {
        // Only cancel/teardown releases this turn.
        await new Promise<never>((_resolve, reject) => {
          rejectTurn = reject
        })
      }

      active = false
      return { sessionId }
    },
    cancel(id: string) {
      if (!active) return
      active = false
      // Real engine: final aborted bus events fire before prompt() settles.
      bus.emit("text-delta", {
        sessionId: id,
        messageId: "m1",
        partId: "p2",
        delta: "partial",
        text: "partial",
      })
      rejectTurn?.(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
      rejectTurn = null
    },
    isActive: () => active,
    hasActiveRun: () => active,
  }

  return runner as unknown as Runner
}

const store = new MemorySessionStore()
createSession({ directory: "/workspace", id: "seeded-1" }, store)
store.update("seeded-1", { title: "Seeded" })

await runAcpStdio({
  store,
  createRunner: (cwd, connectionStore) => makeFakeRunner(connectionStore, cwd),
})
