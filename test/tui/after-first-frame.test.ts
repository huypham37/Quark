import { describe, expect, test } from "bun:test"
import { afterFirstFrame, type FirstFrameRenderer } from "../../packages/quark/src/tui/after-first-frame"

function fakeRenderer() {
  const callbacks = new Set<() => void>()
  const renderer: FirstFrameRenderer = {
    addPostProcessFn: (fn) => { callbacks.add(fn) },
    removePostProcessFn: (fn) => { callbacks.delete(fn) },
  }
  return { renderer, callbacks, frame: () => { for (const fn of callbacks) fn() } }
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("afterFirstFrame", () => {
  test("does not block the native flush and runs exactly once on the next turn", async () => {
    const { renderer, frame, callbacks } = fakeRenderer()
    const events: string[] = []
    afterFirstFrame(renderer, () => { events.push("catalog loaded") })
    expect(events).toEqual([])
    await nextTurn()
    expect(events).toEqual([])
    frame()
    expect(events).toEqual([])
    events.push("native flush")
    expect(callbacks.size).toBe(0)
    frame()
    await nextTurn()
    expect(events).toEqual(["native flush", "catalog loaded"])
    await nextTurn()
    expect(events).toEqual(["native flush", "catalog loaded"])
  })

  test("can cancel before the first frame", async () => {
    const { renderer, frame, callbacks } = fakeRenderer()
    let calls = 0
    const cancel = afterFirstFrame(renderer, () => { calls++ })
    cancel()
    frame()
    await nextTurn()
    expect(calls).toBe(0)
    expect(callbacks.size).toBe(0)
  })

  test("can cancel queued work after the first frame", async () => {
    const { renderer, frame } = fakeRenderer()
    let calls = 0
    const cancel = afterFirstFrame(renderer, () => { calls++ })
    frame()
    cancel()
    await nextTurn()
    expect(calls).toBe(0)
  })
})
