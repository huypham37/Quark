import type { DesktopState } from "./state"

export function buildContext(state: DesktopState): string | undefined {
  const parts: string[] = []

  if (state.activeFile) {
    parts.push(`Active file: ${state.activeFile}`)
    parts.push(`Active view: ${state.activeView}`)
  }

  if (state.activeDraft) {
    parts.push(`Unsaved draft in editor:\n\`\`\`\n${state.activeDraft}\n\`\`\``)
  }

  if (state.activeReview) {
    parts.push(`Reviewing proposed change to: ${state.activeReview.filePath}`)
  }

  return parts.length > 0 ? parts.join("\n") : undefined
}
