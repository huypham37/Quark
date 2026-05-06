export interface ActiveReview {
  messageId: string
  callId: string
  tool: string           // "edit" | "write"
  filePath: string
  diff: string           // unified diff text
  input: Record<string, unknown>
  permissionRequestId: string
}

export type MiddleView = "visual" | "source" | "preview" | "diff"

export interface DesktopState {
  activeFile: string | null
  activeDraft: string | null
  activeView: MiddleView
  activeReview: ActiveReview | null
  previewRefreshKey: number
}

export type DesktopAction =
  | { type: "SELECT_FILE"; path: string }
  | { type: "SET_DRAFT"; content: string }
  | { type: "SET_VIEW"; view: MiddleView }
  | { type: "SHOW_DIFF"; review: ActiveReview }
  | { type: "CLEAR_REVIEW" }
  | { type: "REFRESH_PREVIEW" }

export const initialDesktopState: DesktopState = {
  activeFile: null,
  activeDraft: null,
  activeView: "source",
  activeReview: null,
  previewRefreshKey: 0,
}

export function desktopReducer(s: DesktopState, a: DesktopAction): DesktopState {
  switch (a.type) {
    case "SELECT_FILE":
      return { ...s, activeFile: a.path, activeView: "source", activeDraft: null, activeReview: null }
    case "SET_DRAFT":
      return { ...s, activeDraft: a.content }
    case "SET_VIEW":
      return { ...s, activeView: a.view }
    case "SHOW_DIFF":
      return { ...s, activeReview: a.review, activeView: "diff", activeFile: a.review.filePath }
    case "CLEAR_REVIEW":
      return { ...s, activeReview: null, activeView: s.activeFile ? "source" : "source" }
    case "REFRESH_PREVIEW":
      return { ...s, previewRefreshKey: s.previewRefreshKey + 1 }
    default:
      return s
  }
}
