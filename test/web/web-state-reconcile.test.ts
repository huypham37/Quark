// Pure reducer unit tests for RECONCILE_USER_MSG and the updated ADD_USER_MSG.
//
// Covers:
//   1. RECONCILE_USER_MSG — optimistic message exists → renamed to realId
//   2. RECONCILE_USER_MSG — optimistic not committed yet → adds realId, records optimisticId
//   3. RECONCILE_USER_MSG — realId already present → no-op (dedup)
//   4. ADD_USER_MSG — id is in _reconciledOptIds → skipped
//   5. ADD_USER_MSG — normal id not yet in state → added as usual
//   6. Full race: RECONCILE fires before ADD_USER_MSG → single message with realId

import { describe, test, expect } from "bun:test"
import { reducer, initialState } from "../../src/web/client/state"
import type { AppState, Message } from "../../src/web/client/state"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal user message. */
function userMsg(id: string, text = "hello"): Message {
  return { id, role: "user", parts: [{ type: "text", text }] }
}

/** Seed state with pre-existing messages (and optionally reconciled IDs). */
function stateWith(
  messages: Message[],
  reconciledOptIds: string[] = [],
): AppState {
  return {
    ...initialState,
    messages,
    _reconciledOptIds: new Set(reconciledOptIds),
  }
}

// ── RECONCILE_USER_MSG ────────────────────────────────────────────────────────

describe("RECONCILE_USER_MSG", () => {
  test("renames optimistic message to realId when optimistic already in state", () => {
    const base = stateWith([userMsg("opt-1", "hello")])

    const next = reducer(base, {
      type: "RECONCILE_USER_MSG",
      optimisticId: "opt-1",
      realId: "real-1",
      text: "hello",
    })

    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].id).toBe("real-1")
    // Content preserved
    expect(next.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello" })
    // No optimistic id recorded (rename path doesn't need suppression)
    expect(next._reconciledOptIds.has("opt-1")).toBe(false)
  })

  test("adds new message with realId and records optimisticId when optimistic not yet committed", () => {
    // State has no optimistic message at all
    const base = stateWith([])

    const next = reducer(base, {
      type: "RECONCILE_USER_MSG",
      optimisticId: "opt-2",
      realId: "real-2",
      text: "world",
    })

    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].id).toBe("real-2")
    expect(next.messages[0].role).toBe("user")
    expect(next.messages[0].parts[0]).toMatchObject({ type: "text", text: "world" })
    // optimisticId must be recorded so the late ADD_USER_MSG is suppressed
    expect(next._reconciledOptIds.has("opt-2")).toBe(true)
  })

  test("is a no-op (dedup) when realId already exists in state", () => {
    const existing = userMsg("real-3", "already here")
    const base = stateWith([existing])

    const next = reducer(base, {
      type: "RECONCILE_USER_MSG",
      optimisticId: "opt-3",
      realId: "real-3",
      text: "already here",
    })

    // State reference is returned unchanged
    expect(next).toBe(base)
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].id).toBe("real-3")
  })

  test("does not disturb other messages when renaming", () => {
    const base = stateWith([
      userMsg("other-msg", "other"),
      userMsg("opt-4", "mine"),
    ])

    const next = reducer(base, {
      type: "RECONCILE_USER_MSG",
      optimisticId: "opt-4",
      realId: "real-4",
      text: "mine",
    })

    expect(next.messages).toHaveLength(2)
    expect(next.messages[0].id).toBe("other-msg")
    expect(next.messages[1].id).toBe("real-4")
  })
})

// ── ADD_USER_MSG ──────────────────────────────────────────────────────────────

describe("ADD_USER_MSG", () => {
  test("adds message normally when id is not reconciled and not duplicate", () => {
    const base = stateWith([])

    const next = reducer(base, {
      type: "ADD_USER_MSG",
      id: "opt-5",
      text: "fresh message",
    })

    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].id).toBe("opt-5")
    expect(next.messages[0].role).toBe("user")
    expect(next.messages[0].parts[0]).toMatchObject({ type: "text", text: "fresh message" })
  })

  test("skips adding when id is already in _reconciledOptIds", () => {
    // Simulate: RECONCILE_USER_MSG ran first and recorded this optimistic id
    const base = stateWith([userMsg("real-6", "text")], ["opt-6"])

    const next = reducer(base, {
      type: "ADD_USER_MSG",
      id: "opt-6",
      text: "text",
    })

    // State must be returned unchanged — no new message added
    expect(next).toBe(base)
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0].id).toBe("real-6")
  })

  test("skips adding when id already exists (existing dedup guard)", () => {
    const base = stateWith([userMsg("opt-7", "dup")])

    const next = reducer(base, {
      type: "ADD_USER_MSG",
      id: "opt-7",
      text: "dup",
    })

    expect(next).toBe(base)
    expect(next.messages).toHaveLength(1)
  })

  test("attaches image parts when images are provided", () => {
    const base = stateWith([])

    const next = reducer(base, {
      type: "ADD_USER_MSG",
      id: "opt-8",
      text: "pic",
      images: [{ mime: "image/png", data: "abc123" }],
    })

    expect(next.messages[0].parts).toHaveLength(2)
    expect(next.messages[0].parts[1]).toMatchObject({
      type: "image",
      mime: "image/png",
      data: "abc123",
    })
  })
})

// ── Full race scenario ────────────────────────────────────────────────────────

describe("race: RECONCILE_USER_MSG fires before ADD_USER_MSG", () => {
  test("message appears exactly once with realId; subsequent ADD_USER_MSG is suppressed", () => {
    // Step 0: empty state (React hasn't dispatched ADD_USER_MSG yet)
    let state = stateWith([])

    // Step 1: WebSocket delivers 'user-message' with the real server id
    state = reducer(state, {
      type: "RECONCILE_USER_MSG",
      optimisticId: "opt-race",
      realId: "real-race",
      text: "race condition message",
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].id).toBe("real-race")
    expect(state._reconciledOptIds.has("opt-race")).toBe(true)

    // Step 2: React commits the deferred ADD_USER_MSG with the optimistic id
    const stateAfterAdd = reducer(state, {
      type: "ADD_USER_MSG",
      id: "opt-race",
      text: "race condition message",
    })

    // Must be suppressed — state unchanged
    expect(stateAfterAdd).toBe(state)
    expect(stateAfterAdd.messages).toHaveLength(1)
    expect(stateAfterAdd.messages[0].id).toBe("real-race")
  })
})
