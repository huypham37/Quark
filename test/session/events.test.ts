// TypedBus error safety.
//
// Node's EventEmitter treats 'error' specially: emitting it with no listener
// throws ERR_UNHANDLED_ERROR, which would mask the original runner error.
// These pin the permanent guard that prevents it without changing the public
// "error" event name.

import { describe, expect, test } from "bun:test"
import { TypedBus } from "../../packages/runner/src/session/events"

describe("TypedBus: unobserved 'error' is safe", () => {
  test("emit('error') with no listener does not throw", () => {
    const bus = new TypedBus()
    expect(() => bus.emit("error", { sessionId: "s1", error: new Error("boom") })).not.toThrow()
  })

  test("removeAllListeners() does not reintroduce the crash", () => {
    const bus = new TypedBus()
    bus.on("error", () => {})
    bus.removeAllListeners()
    expect(() => bus.emit("error", { sessionId: "s1", error: "boom" })).not.toThrow()
  })

  test("removeAllListeners('error') does not reintroduce the crash", () => {
    const bus = new TypedBus()
    bus.on("error", () => {})
    bus.removeAllListeners("error")
    expect(() => bus.emit("error", { sessionId: "s1", error: "boom" })).not.toThrow()
  })

  test("observed handler receives the error exactly once", () => {
    const bus = new TypedBus()
    const seen: unknown[] = []
    bus.on("error", (data) => seen.push(data.error))
    bus.emit("error", { sessionId: "s1", error: new Error("boom") })
    expect(seen).toHaveLength(1)
    expect((seen[0] as Error).message).toBe("boom")
  })

  test("handler added after removeAllListeners still receives errors", () => {
    const bus = new TypedBus()
    bus.removeAllListeners()
    let received = 0
    bus.on("error", () => { received++ })
    bus.emit("error", { sessionId: "s1", error: "boom" })
    expect(received).toBe(1)
  })

  test("once('error') still fires exactly once", () => {
    const bus = new TypedBus()
    let calls = 0
    bus.once("error", () => { calls++ })
    bus.emit("error", { sessionId: "s1", error: "a" })
    bus.emit("error", { sessionId: "s1", error: "b" })
    expect(calls).toBe(1)
  })

  test(">101 consumer listeners do not trigger a MaxListeners warning", async () => {
    const warnings: Error[] = []
    const onWarning = (warning: Error) => warnings.push(warning)
    process.on("warning", onWarning)
    try {
      const bus = new TypedBus()
      for (let i = 0; i < 150; i++) bus.on("error", () => {})
      // MaxListenersExceededWarning is emitted asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(warnings.filter((w) => w.name === "MaxListenersExceededWarning")).toHaveLength(0)
      // And all 150 consumers plus the guard still receive the event.
      let received = 0
      bus.removeAllListeners("error")
      for (let i = 0; i < 150; i++) bus.on("error", () => { received++ })
      bus.emit("error", { sessionId: "s1", error: "boom" })
      expect(received).toBe(150)
    } finally {
      process.off("warning", onWarning)
    }
  })
})
