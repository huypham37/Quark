import { describe, test, expect } from "vitest"
import { desktopReducer, initialDesktopState } from "../state"
import type { DesktopState, ActiveReview } from "../state"

const mockReview: ActiveReview = {
  messageId: "msg-1",
  callId: "call-1",
  tool: "edit",
  filePath: "src/foo.ts",
  diff: "@@ -1,3 +1,4 @@\n context\n-old\n+new\n context",
  input: { filePath: "src/foo.ts" },
  permissionRequestId: "req-1",
}

describe("desktopReducer", () => {
  test("SELECT_FILE sets activeFile and switches to source", () => {
    const state = desktopReducer(initialDesktopState, { type: "SELECT_FILE", path: "src/bar.ts" })
    expect(state.activeFile).toBe("src/bar.ts")
    expect(state.activeView).toBe("source")
    expect(state.activeReview).toBeNull()
  })

  test("SELECT_FILE clears draft and review", () => {
    const withData: DesktopState = {
      ...initialDesktopState,
      activeDraft: "old draft",
      activeReview: mockReview,
    }
    const state = desktopReducer(withData, { type: "SELECT_FILE", path: "f.ts" })
    expect(state.activeDraft).toBeNull()
    expect(state.activeReview).toBeNull()
  })

  test("SET_DRAFT stores content", () => {
    const state = desktopReducer(initialDesktopState, { type: "SET_DRAFT", content: "hello world" })
    expect(state.activeDraft).toBe("hello world")
  })

  test("SET_VIEW changes view", () => {
    const state = desktopReducer(initialDesktopState, { type: "SET_VIEW", view: "preview" })
    expect(state.activeView).toBe("preview")
  })

  test("SHOW_DIFF sets review and switches to diff view", () => {
    const state = desktopReducer(initialDesktopState, { type: "SHOW_DIFF", review: mockReview })
    expect(state.activeReview).toEqual(mockReview)
    expect(state.activeView).toBe("diff")
    expect(state.activeFile).toBe("src/foo.ts")
  })

  test("CLEAR_REVIEW clears review but keeps file", () => {
    const withReview: DesktopState = {
      ...initialDesktopState,
      activeReview: mockReview,
      activeFile: "src/foo.ts",
      activeView: "diff",
    }
    const state = desktopReducer(withReview, { type: "CLEAR_REVIEW" })
    expect(state.activeReview).toBeNull()
    expect(state.activeFile).toBe("src/foo.ts")
    expect(state.activeView).toBe("source")
  })

  test("REFRESH_PREVIEW increments key", () => {
    const state = desktopReducer(initialDesktopState, { type: "REFRESH_PREVIEW" })
    expect(state.previewRefreshKey).toBe(1)
    const state2 = desktopReducer(state, { type: "REFRESH_PREVIEW" })
    expect(state2.previewRefreshKey).toBe(2)
  })

  test("unknown action returns same state", () => {
    const state = desktopReducer(initialDesktopState, { type: "UNKNOWN" as any } as any)
    expect(state).toEqual(initialDesktopState)
  })
})
